import store from '@renderer/store'
import { startDownload, stopDownload, updateDownloadProgress } from '@renderer/store/llm'

interface DownloadProgress {
  status: string
  total?: number
  completed?: number
  digest?: string
}

interface AvailableModel {
  showname: string
  name: string
  description: string
  tags: string[]
  size: string
  pullable: boolean
  source: string
}

class OllamaDownloadService {
  private downloadControllers = new Map<string, AbortController>()
  private completedDownloads = new Set<string>()
  private availableModels: AvailableModel[] = []

  /**
   * 设置可用模型数据（用于获取 showname）
   */
  setAvailableModels(models: AvailableModel[]): void {
    this.availableModels = models
  }

  /**
   * 根据模型名称获取显示名称
   */
  private getModelDisplayName(modelName: string): string {
    const model = this.availableModels.find((m) => m.name === modelName || modelName.startsWith(`${m.name}:`))
    return model?.showname || modelName
  }

  /**
   * 开始下载模型
   */
  async downloadModel(modelName: string, apiHost: string): Promise<void> {
    // 如果已经在下载，跳过
    if (this.downloadControllers.has(modelName)) {
      const displayName = this.getModelDisplayName(modelName)
      console.warn(`Model ${displayName} is already downloading`)
      return
    }

    // 创建新的 AbortController
    const controller = new AbortController()
    this.downloadControllers.set(modelName, controller)

    // 清理该模型的完成记录，允许重新下载
    this.completedDownloads.delete(modelName)

    // 更新全局状态
    store.dispatch(startDownload(modelName))

    try {
      const response = await fetch(`${apiHost}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error('Download failed')
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('Response body is not readable')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          // 检查是否被取消
          if (controller.signal.aborted) {
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.trim()) {
              try {
                const data: DownloadProgress = JSON.parse(line)

                // 更新进度到全局状态
                store.dispatch(updateDownloadProgress({ modelName, progress: data }))

                if (data.status === 'success') {
                  // 检查是否已经处理过这个模型的下载完成
                  if (this.completedDownloads.has(modelName)) {
                    return // 已经处理过，避免重复提示
                  }

                  // 标记为已完成
                  this.completedDownloads.add(modelName)

                  // 使用 showname 显示提示信息
                  const displayName = this.getModelDisplayName(modelName)
                  window.message.success(`模型 ${displayName} 下载完成，已自动添加到本地模型库`)

                  // 完成下载，清理状态
                  this.cleanupDownload(modelName)
                  return
                }
              } catch (parseError) {
                console.error('Failed to parse response line:', line, parseError)
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // 下载被取消，不显示错误消息
        return
      }
      console.error('Failed to download model:', error)

      // 使用 showname 显示提示信息
      const displayName = this.getModelDisplayName(modelName)
      window.message.error(`下载模型 ${displayName} 失败: ${error.message}`)

      // 清理状态
      this.cleanupDownload(modelName)
    }
  }

  /**
   * 取消下载
   */
  cancelDownload(modelName: string): void {
    const controller = this.downloadControllers.get(modelName)
    if (controller) {
      controller.abort()
      this.completedDownloads.delete(modelName)
      this.cleanupDownload(modelName)

      // 使用 showname 显示提示信息
      const displayName = this.getModelDisplayName(modelName)
      window.message.info(`已取消下载模型 ${displayName}`)
    }
  }

  /**
   * 检查模型是否正在下载
   */
  isDownloading(modelName: string): boolean {
    return this.downloadControllers.has(modelName)
  }

  /**
   * 获取所有正在下载的模型
   */
  getDownloadingModels(): string[] {
    return Array.from(this.downloadControllers.keys())
  }

  /**
   * 清理下载状态
   */
  private cleanupDownload(modelName: string): void {
    this.downloadControllers.delete(modelName)
    store.dispatch(stopDownload(modelName))
  }

  /**
   * 清理所有下载
   */
  clearAllDownloads(): void {
    // 取消所有正在进行的下载
    for (const [modelName] of this.downloadControllers) {
      this.cancelDownload(modelName)
    }

    // 清理记录
    this.downloadControllers.clear()
    this.completedDownloads.clear()
  }
}

// 导出单例实例
export const ollamaDownloadService = new OllamaDownloadService()
export default ollamaDownloadService
