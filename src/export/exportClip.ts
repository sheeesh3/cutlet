import { getState, clipBounds, setExporting, sentences, sentenceById, logTool } from '../state/store'
import { buildSrt } from './srt'
import { formatTimecode } from '../transcript/sentences'

type FFmpegInstance = {
  loaded?: boolean
  load: (opts: { coreURL: string; wasmURL: string }) => Promise<void>
  on: (event: string, cb: (payload: { progress?: number; message?: string }) => void) => void
  writeFile: (path: string, data: Uint8Array) => Promise<unknown>
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
      const base = `${import.meta.env.BASE_URL}ffmpeg`
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
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

export async function exportClip(clipId: string): Promise<void> {
  const state = getState()
  const clip = state.clips.find((c) => c.id === clipId)
  const project = state.project
  if (!clip || !project) return

  const { start, end } = clipBounds(clip)
  const duration = end - start
  if (duration <= 0) return

  const name = safeName(clip.title)

  // The .srt costs nothing and does not need ffmpeg, so it lands first — if the
  // encode fails, the user still has the text with correct timings.
  const a = sentenceById(clip.startSentenceId)
  const b = sentenceById(clip.endSentenceId)
  if (a && b) {
    const srt = buildSrt(sentences().slice(a.index, b.index + 1), start)
    download(new Blob([srt], { type: 'text/plain;charset=utf-8' }), `${name}.srt`)
  }

  try {
    setExporting({ clipId, stage: 'Loading the encoder', progress: 0 })
    const ffmpeg = await getFFmpeg()

    setExporting({ clipId, stage: 'Reading the video', progress: 0.05 })
    const response = await fetch(project.videoUrl)
    if (!response.ok) throw new Error(`Could not read the video (${response.status}).`)
    const input = new Uint8Array(await response.arrayBuffer())

    const inputName = 'input.mp4'
    const outputName = `${name}.mp4`
    await ffmpeg.writeFile(inputName, input)

    ffmpeg.on('progress', ({ progress }) => {
      if (typeof progress !== 'number') return
      const clamped = Math.min(1, Math.max(0, progress))
      setExporting({
        clipId,
        stage: `Encoding ${formatTimecode(start)} – ${formatTimecode(end)}`,
        progress: 0.1 + clamped * 0.85,
      })
    })

    setExporting({ clipId, stage: 'Encoding', progress: 0.1 })

    /**
     * Re-encode rather than stream-copy. `-c copy` can only cut on a keyframe,
     * so a copy-cut silently slides the in-point to the previous keyframe —
     * which is exactly the sentence boundary we promised to honour. Re-encoding
     * a sub-minute clip is fast enough to be worth an exact edge.
     *
     * `-ss` before `-i` seeks fast; `-t` after it bounds the output.
     */
    await ffmpeg.exec([
      '-ss', start.toFixed(3),
      '-i', inputName,
      '-t', duration.toFixed(3),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputName,
    ])

    setExporting({ clipId, stage: 'Saving', progress: 0.97 })
    const data = (await ffmpeg.readFile(outputName)) as Uint8Array
    download(new Blob([data as BlobPart], { type: 'video/mp4' }), outputName)

    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})

    logTool('export', `Exported "${clip.title}" — ${outputName} and ${name}.srt.`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ClipClub] export failed', err)
    logTool('export', `Export failed: ${message}`, false)
    alert(
      `Could not export that clip.\n\n${message}\n\nThe .srt was still saved with the ` +
        `correct timings.`
    )
  } finally {
    setExporting(null)
  }
}
