import {
  getState,
  clipRanges,
  clipDuration,
  sentences,
  setExporting,
  logTool,
} from '../state/store'
import { buildSrt } from './srt'
import { formatDuration } from '../transcript/sentences'

type FFmpegInstance = {
  load: (opts: { coreURL: string; wasmURL: string }) => Promise<void>
  on: (event: string, cb: (payload: { progress?: number; message?: string }) => void) => void
  writeFile: (path: string, data: Uint8Array | string) => Promise<unknown>
  readFile: (path: string) => Promise<unknown>
  deleteFile: (path: string) => Promise<unknown>
  exec: (args: string[]) => Promise<unknown>
}

let ffmpegPromise: Promise<FFmpegInstance> | null = null

/**
 * Loaded on first export, never at boot. The single-thread core is ~31MB and
 * most sessions never export — making everyone pay that on load would be rude.
 *
 * Single-thread is also the reason this page needs no COOP/COEP headers, which
 * is what lets it deploy to plain static hosting.
 */
async function getFFmpeg(): Promise<FFmpegInstance> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import('@ffmpeg/ffmpeg'),
        import('@ffmpeg/util'),
      ])
      const ffmpeg = new FFmpeg() as unknown as FFmpegInstance
      ffmpeg.on('log', ({ message }) => {
        if (message && /error|Error|Invalid/.test(message)) console.warn('[ffmpeg]', message)
      })

      // The core has to arrive as blob URLs. ffmpeg.wasm loads it from inside a
      // worker, and a bare path gets rewritten by the dev server (…/core.js
      // becomes …/core.js?import) and can trip cross-origin rules in
      // production. A blob URL is neither rewritten nor cross-origin.
      const base = import.meta.env.BASE_URL + 'ffmpeg'
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(base + '/ffmpeg-core.js', 'text/javascript'),
        toBlobURL(base + '/ffmpeg-core.wasm', 'application/wasm'),
      ])
      await ffmpeg.load({ coreURL, wasmURL })
      return ffmpeg
    })()
    ffmpegPromise.catch(() => {
      ffmpegPromise = null
    })
  }
  return ffmpegPromise
}

function safeName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return slug || 'clip'
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Encoding settings shared by every piece of a cut. They have to match exactly,
 * because the pieces are joined by stream copy afterwards and the concat
 * demuxer will not join streams whose parameters differ.
 */
const ENCODE = [
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-crf', '23',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-b:a', '128k',
  '-ar', '48000',
  '-ac', '2',
]

export async function exportClip(clipId: string): Promise<void> {
  const state = getState()
  const clip = state.clips.find((c) => c.id === clipId)
  const project = state.project
  if (!clip || !project) return

  const ranges = clipRanges(clip)
  const total = clipDuration(clip)
  if (!ranges.length || total <= 0) return

  const name = safeName(clip.title)

  // The .srt costs nothing and needs no encoder, so it lands first — if the
  // encode fails, the user still has the text with correct timings.
  const srt = buildSrt(sentences(), ranges)
  if (srt.trim()) {
    download(new Blob([srt], { type: 'text/plain;charset=utf-8' }), name + '.srt')
  }

  try {
    setExporting({ clipId, stage: 'Loading the encoder', progress: 0 })
    const ffmpeg = await getFFmpeg()

    setExporting({ clipId, stage: 'Reading the video', progress: 0.04 })
    const response = await fetch(project.videoUrl)
    if (!response.ok) throw new Error('Could not read the video (' + response.status + ').')
    const input = new Uint8Array(await response.arrayBuffer())

    const inputName = 'input.mp4'
    const outputName = name + '.mp4'
    await ffmpeg.writeFile(inputName, input)

    const written: string[] = [inputName]

    /**
     * Each piece is re-encoded rather than stream-copied. `-c copy` can only cut
     * on a keyframe, so a copy-cut silently slides the in-point back to the
     * previous keyframe — which is exactly the sentence boundary the whole app
     * is built on. `-ss` before `-i` seeks fast and still lands accurately when
     * re-encoding.
     */
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i]
      const length = Math.max(0.05, range.end - range.start)
      const part = 'part' + i + '.mp4'

      setExporting({
        clipId,
        stage:
          ranges.length > 1
            ? 'Encoding piece ' + (i + 1) + ' of ' + ranges.length
            : 'Encoding ' + formatDuration(total),
        progress: 0.06 + (i / ranges.length) * 0.82,
      })

      await ffmpeg.exec([
        '-ss', range.start.toFixed(3),
        '-i', inputName,
        '-t', length.toFixed(3),
        ...ENCODE,
        part,
      ])
      written.push(part)
    }

    if (ranges.length === 1) {
      setExporting({ clipId, stage: 'Saving', progress: 0.95 })
      const data = (await ffmpeg.readFile('part0.mp4')) as Uint8Array
      download(new Blob([data as BlobPart], { type: 'video/mp4' }), outputName)
    } else {
      // Joining by stream copy: the pieces were just encoded with identical
      // settings, so there is nothing to re-decide and no second generation of
      // quality loss.
      setExporting({ clipId, stage: 'Joining ' + ranges.length + ' pieces', progress: 0.9 })
      const list = ranges.map((_, i) => "file 'part" + i + ".mp4'").join('\n') + '\n'
      await ffmpeg.writeFile('parts.txt', list)
      written.push('parts.txt')

      await ffmpeg.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', 'parts.txt',
        '-c', 'copy',
        '-movflags', '+faststart',
        outputName,
      ])
      written.push(outputName)

      setExporting({ clipId, stage: 'Saving', progress: 0.97 })
      const data = (await ffmpeg.readFile(outputName)) as Uint8Array
      download(new Blob([data as BlobPart], { type: 'video/mp4' }), outputName)
    }

    for (const file of written) {
      await ffmpeg.deleteFile(file).catch(() => {})
    }

    logTool(
      'export',
      'Exported "' + clip.title + '" — ' + formatDuration(total) +
        (ranges.length > 1 ? ' from ' + ranges.length + ' pieces' : '') +
        ', plus ' + name + '.srt.'
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ClipClub] export failed', err)
    logTool('export', 'Export failed: ' + message, false)
    alert(
      'Could not export that clip.\n\n' + message +
        '\n\nThe .srt was still saved with the correct timings.'
    )
  } finally {
    setExporting(null)
  }
}
