import { link, open, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileTimestamp, sanitizeFileSegment } from '../filename'

export const recordingBaseName = (name: string, now = new Date()): string =>
  `${sanitizeFileSegment(name)}-${fileTimestamp(now)}`
export const publishRecording = async (
  temporary: string,
  directory: string,
  base: string
): Promise<string> => {
  const file = await open(temporary, 'r')
  try {
    const header = Buffer.alloc(12)
    await file.read(header, 0, 12, 0)
    if (header.toString('ascii', 4, 8) !== 'ftyp' || (await file.stat()).size < 100)
      throw new Error('Invalid MP4 output')
  } finally {
    await file.close()
  }
  for (let suffix = 1; suffix <= 10000; suffix++) {
    const name = `${base}${suffix === 1 ? '' : `-${suffix}`}.mp4`
    try {
      await link(temporary, join(directory, name))
      await rm(temporary, { force: true }).catch((error) =>
        console.warn('[recording] published temporary cleanup failed', error)
      )
      return name
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('Unable to allocate MP4 filename')
}
export const assertSavedFile = async (path: string): Promise<void> => {
  if (!(await stat(path)).isFile()) throw new Error('Saved video is missing')
}
