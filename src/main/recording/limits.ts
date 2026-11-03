/** 基于 P0 两 AVD 620 秒的保守首版 admission；不是硬件最大能力声明。 */
export const MAX_CONCURRENT_RECORDINGS = 2
export const MAX_SPOOL_BYTES = 16 * 1024 * 1024
export const MAX_PACKET_BYTES = 16 * 1024 * 1024
export const PROCESS_BATCH_PACKETS = 8
export const PROCESS_BATCH_BYTES = 8 * 1024 * 1024
export const KEYFRAME_TIMEOUT_MS = 15_000
export const AUDIO_STALL_MS = 5_000
