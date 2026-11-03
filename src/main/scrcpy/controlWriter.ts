import { ScrcpyControlMessageSerializer, ScrcpyControlMessageWriter } from '@yume-chan/scrcpy'
import { Consumable } from '@yume-chan/stream-extra'

type WriterArgs = ConstructorParameters<typeof ScrcpyControlMessageWriter>

/** 同时观察写入与 consumed/ACK，任一失败都不留下无人处理的 Promise。 */
export class SafeControlMessageWriter extends ScrcpyControlMessageWriter {
  private readonly clipboardSerializer: ScrcpyControlMessageSerializer

  constructor(
    private readonly rawWriter: WriterArgs[0],
    options: WriterArgs[1]
  ) {
    super(rawWriter, options)
    this.clipboardSerializer = new ScrcpyControlMessageSerializer(options)
  }

  override async write(message: Uint8Array): Promise<void> {
    const chunk = new Consumable(message)
    await Promise.all([this.rawWriter.write(chunk), chunk.consumed])
  }

  override async setClipboard(
    message: Parameters<ScrcpyControlMessageWriter['setClipboard']>[0]
  ): Promise<void> {
    const result = this.clipboardSerializer.setClipboard(message)
    if (result instanceof Uint8Array) await this.write(result)
    else await Promise.all([this.write(result[0]), result[1]])
  }
}
