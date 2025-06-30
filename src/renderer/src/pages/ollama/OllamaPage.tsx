import { CloudDownloadOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { useProvider } from '@renderer/hooks/useProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setOllamaKeepAliveTime } from '@renderer/store/llm'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Input,
  InputNumber,
  Progress,
  Row,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import { CheckCircle, Download, RefreshCw, Server, Settings, Trash2, X } from 'lucide-react'
import { FC, useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'

const { Text, Paragraph } = Typography

interface OllamaModel {
  name: string
  size: number
  modified_at: string
  digest: string
  details?: {
    family?: string
    format?: string
    parameter_size?: string
    quantization_level?: string
  }
}

interface AvailableModel {
  name: string
  description: string
  tags: string[]
  size: string
  pullable: boolean
}

interface DownloadProgress {
  status: string
  total?: number
  completed?: number
  digest?: string
}

const OllamaPage: FC = () => {
  const dispatch = useAppDispatch()
  const { resourcesPath } = useRuntime()

  const { provider: ollamaProvider, updateProvider } = useProvider('ollama')
  const { settings } = useAppSelector((state) => state.llm)

  const [installedModels, setInstalledModels] = useState<OllamaModel[]>([])
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [loading, setLoading] = useState(false)
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set())
  const [downloadProgress, setDownloadProgress] = useState<Map<string, DownloadProgress>>(new Map())
  const [downloadControllers, setDownloadControllers] = useState<Map<string, AbortController>>(new Map())
  const [apiHost, setApiHost] = useState(ollamaProvider?.apiHost || 'http://localhost:11434')
  const [isConnected, setIsConnected] = useState(false)
  const [checkingConnection, setCheckingConnection] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [clickCount, setClickCount] = useState(0)
  const [clickTimeout, setClickTimeout] = useState<NodeJS.Timeout | null>(null)

  // 处理设置图标点击
  const handleConfigIconClick = useCallback(() => {
    if (clickTimeout) {
      clearTimeout(clickTimeout)
    }

    const newCount = clickCount + 1
    setClickCount(newCount)

    if (newCount >= 5) {
      setShowConfig(true)
      setClickCount(0)
      setClickTimeout(null)
    } else {
      // 设置2秒超时，如果没有继续点击则重置计数
      const timeout = setTimeout(() => {
        setClickCount(0)
        setClickTimeout(null)
      }, 2000)
      setClickTimeout(timeout)
    }
  }, [clickCount, clickTimeout])

  // 清理超时器
  useEffect(() => {
    return () => {
      if (clickTimeout) {
        clearTimeout(clickTimeout)
      }
    }
  }, [clickTimeout])

  // 检查本地模型服务连接状态
  const checkConnection = useCallback(async () => {
    setCheckingConnection(true)
    try {
      const response = await fetch(`${apiHost}/api/version`)
      setIsConnected(response.ok)
    } catch (error) {
      setIsConnected(false)
    } finally {
      setCheckingConnection(false)
    }
  }, [apiHost])

  // 获取已安装的模型列表
  const fetchInstalledModels = useCallback(async () => {
    if (!isConnected) return

    setLoading(true)
    try {
      const response = await fetch(`${apiHost}/api/tags`)
      const data = await response.json()
      setInstalledModels(data.models || [])
    } catch (error) {
      console.error('Failed to fetch installed models:', error)
    } finally {
      setLoading(false)
    }
  }, [apiHost, isConnected])

  // 获取可下载的模型列表
  const fetchAvailableModels = useCallback(async () => {
    try {
      if (!resourcesPath) {
        console.error('Resources path not available')
        return
      }

      const modelsData = await window.api.fs.read(`${resourcesPath}/data/ollama-models.json`, 'utf-8')
      const models: AvailableModel[] = JSON.parse(modelsData)
      setAvailableModels(models)
    } catch (error) {
      console.error('Failed to load local models from JSON:', error)
      // 如果读取文件失败，使用默认的空数组
      setAvailableModels([])
    }
  }, [resourcesPath])

  // 取消下载
  const cancelDownload = useCallback(
    (modelName: string) => {
      const controller = downloadControllers.get(modelName)
      if (controller) {
        controller.abort()
        setDownloadingModels((prev) => {
          const next = new Set(prev)
          next.delete(modelName)
          return next
        })
        setDownloadProgress((prev) => {
          const next = new Map(prev)
          next.delete(modelName)
          return next
        })
        setDownloadControllers((prev) => {
          const next = new Map(prev)
          next.delete(modelName)
          return next
        })
        window.message.info(`已取消下载模型 ${modelName}`)
      }
    },
    [downloadControllers]
  )

  // 下载模型
  const downloadModel = useCallback(
    async (modelName: string) => {
      // 创建新的 AbortController
      const controller = new AbortController()

      setDownloadingModels((prev) => new Set(prev).add(modelName))
      setDownloadProgress((prev) => new Map(prev).set(modelName, { status: 'starting' }))
      setDownloadControllers((prev) => new Map(prev).set(modelName, controller))

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
                  const data = JSON.parse(line)
                  setDownloadProgress((prev) => new Map(prev).set(modelName, data))

                  if (data.status === 'success') {
                    window.message.success(`模型 ${modelName} 下载完成`)
                    fetchInstalledModels()
                    setDownloadingModels((prev) => {
                      const next = new Set(prev)
                      next.delete(modelName)
                      return next
                    })
                    setDownloadProgress((prev) => {
                      const next = new Map(prev)
                      next.delete(modelName)
                      return next
                    })
                    setDownloadControllers((prev) => {
                      const next = new Map(prev)
                      next.delete(modelName)
                      return next
                    })
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
        window.message.error(`下载模型失败: ${error.message}`)
        setDownloadingModels((prev) => {
          const next = new Set(prev)
          next.delete(modelName)
          return next
        })
        setDownloadProgress((prev) => {
          const next = new Map(prev)
          next.delete(modelName)
          return next
        })
        setDownloadControllers((prev) => {
          const next = new Map(prev)
          next.delete(modelName)
          return next
        })
      }
    },
    [apiHost, fetchInstalledModels]
  )

  // 删除模型
  const deleteModel = useCallback(
    async (modelName: string) => {
      try {
        const response = await fetch(`${apiHost}/api/delete`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modelName })
        })

        if (response.ok) {
          window.message.success(`模型 ${modelName} 删除成功`)
          fetchInstalledModels()
        } else {
          throw new Error('Delete failed')
        }
      } catch (error) {
        console.error('Failed to delete model:', error)
        window.message.error(`删除模型失败: ${error}`)
      }
    },
    [apiHost, fetchInstalledModels]
  )

  // 更新 API Host
  const updateApiHost = useCallback(() => {
    if (ollamaProvider) {
      updateProvider({ ...ollamaProvider, apiHost })
    }
  }, [ollamaProvider, apiHost, updateProvider])

  // 更新 Keep Alive 时间
  const updateKeepAliveTime = useCallback(
    (value: number) => {
      dispatch(setOllamaKeepAliveTime(value))
    },
    [dispatch]
  )

  useEffect(() => {
    checkConnection()
  }, [checkConnection])

  useEffect(() => {
    if (isConnected) {
      fetchInstalledModels()
      fetchAvailableModels()
    }
  }, [isConnected, fetchInstalledModels, fetchAvailableModels])

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString()
  }

  const getDownloadPercentage = (progress: DownloadProgress): number => {
    if (progress.total && progress.completed) {
      return Math.round((progress.completed / progress.total) * 100)
    }
    return 0
  }

  const getProgressStatus = (status: string): 'active' | 'success' | 'exception' | 'normal' => {
    switch (status) {
      case 'success':
        return 'success'
      case 'error':
        return 'exception'
      default:
        return 'active'
    }
  }

  const formatProgressText = (progress: DownloadProgress): string => {
    switch (progress.status) {
      case 'pulling manifest':
        return '正在拉取清单...'
      case 'downloading':
        if (progress.total && progress.completed) {
          const totalMB = (progress.total / (1024 * 1024)).toFixed(1)
          const completedMB = (progress.completed / (1024 * 1024)).toFixed(1)
          return `下载中 ${completedMB}MB / ${totalMB}MB`
        }
        return '下载中...'
      case 'verifying sha256 digest':
        return '验证文件完整性...'
      case 'writing manifest':
        return '写入清单...'
      case 'removing any unused layers':
        return '清理临时文件...'
      case 'success':
        return '下载完成'
      default:
        return progress.status || '准备中...'
    }
  }

  // 检查模型是否已安装
  const isModelInstalled = useCallback(
    (modelName: string): boolean => {
      return installedModels.some((m) => {
        // 精确匹配或前缀匹配（处理标签版本）
        return m.name === modelName || m.name.startsWith(`${modelName}:`)
      })
    },
    [installedModels]
  )

  // 过滤出未安装的可下载模型
  const uninstalledModels = availableModels.filter((model) => !isModelInstalled(model.name))

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>
          <Flex align="center" gap={12}>
            <Server size={20} />
            本地模型管理
          </Flex>
        </NavbarCenter>
      </Navbar>

      <MainContent>
        <Scrollbar>
          <ContentWrapper>
            {/* 配置区域 */}
            {showConfig && (
              <Card
                title={
                  <Flex align="center" gap={8}>
                    <Settings size={18} />
                    基础配置
                    <Button
                      type="text"
                      size="small"
                      onClick={() => setShowConfig(false)}
                      style={{ marginLeft: 'auto' }}>
                      隐藏
                    </Button>
                  </Flex>
                }
                style={{ marginBottom: 24 }}>
                <Row gutter={[16, 16]}>
                  <Col span={12}>
                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                      <Text strong>API 地址</Text>
                      <Input.Group compact>
                        <Input
                          style={{ width: 'calc(100% - 80px)' }}
                          value={apiHost}
                          onChange={(e) => setApiHost(e.target.value)}
                          placeholder="http://localhost:11434"
                        />
                        <Button onClick={updateApiHost}>更新</Button>
                      </Input.Group>
                    </Space>
                  </Col>
                  <Col span={12}>
                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                      <Text strong>连接保持时间 (秒)</Text>
                      <InputNumber
                        style={{ width: '100%' }}
                        value={settings.ollama.keepAliveTime}
                        onChange={(value) => updateKeepAliveTime(value || 0)}
                        min={0}
                        placeholder="0表示使用默认值"
                      />
                    </Space>
                  </Col>
                </Row>

                <Flex align="center" gap={8} style={{ marginTop: 16 }}>
                  <Text>连接状态:</Text>
                  {checkingConnection ? (
                    <Spin size="small" />
                  ) : (
                    <Tag color={isConnected ? 'success' : 'error'}>{isConnected ? '已连接' : '未连接'}</Tag>
                  )}
                  <Button size="small" icon={<RefreshCw size={14} />} onClick={checkConnection}>
                    检查连接
                  </Button>
                </Flex>
              </Card>
            )}

            {/* 当配置区域隐藏时显示的提示 */}
            {!showConfig && (
              <Card
                style={{ marginBottom: 24, textAlign: 'center', background: '#fafafa' }}
                bodyStyle={{ padding: '16px' }}>
                <Space direction="vertical" size="small">
                  <Flex align="center" justify="center" gap={8}>
                    <Settings size={18} onClick={handleConfigIconClick} />
                    <Text type="secondary">高级配置</Text>
                  </Flex>
                </Space>
              </Card>
            )}

            {!isConnected && (
              <Alert
                message="无法连接到本地模型服务"
                description="请确保本地模型服务已启动，并检查 API 地址设置是否正确。"
                type="warning"
                showIcon
                style={{ marginBottom: 24 }}
              />
            )}

            {/* 已安装模型 */}
            <Card
              title={
                <Flex align="center" justify="space-between">
                  <Flex align="center" gap={8}>
                    <CheckCircle size={18} />
                    已安装模型 ({installedModels.length})
                  </Flex>
                  <Button icon={<RefreshCw size={14} />} onClick={fetchInstalledModels} loading={loading} size="small">
                    刷新
                  </Button>
                </Flex>
              }
              style={{ marginBottom: 24 }}>
              {loading ? (
                <Flex justify="center" style={{ padding: '40px 0' }}>
                  <Spin size="large" />
                </Flex>
              ) : installedModels.length === 0 ? (
                <Empty description="暂无已安装的模型" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <Row gutter={[16, 16]}>
                  {installedModels.map((model) => (
                    <Col span={12} key={model.name}>
                      <ModelCard>
                        <Card
                          size="small"
                          title={
                            <Flex align="center" justify="space-between">
                              <Text strong>{model.name}</Text>
                              <Tooltip title="删除模型">
                                <Button
                                  type="text"
                                  size="small"
                                  danger
                                  icon={<Trash2 size={14} />}
                                  onClick={() => {
                                    window.modal.confirm({
                                      title: '确认删除',
                                      content: `确定要删除模型 ${model.name} 吗？`,
                                      onOk: () => deleteModel(model.name)
                                    })
                                  }}
                                />
                              </Tooltip>
                            </Flex>
                          }>
                          <Space direction="vertical" size="small" style={{ width: '100%' }}>
                            <Flex justify="space-between">
                              <Text type="secondary">大小:</Text>
                              <Text>{formatSize(model.size)}</Text>
                            </Flex>
                            <Flex justify="space-between">
                              <Text type="secondary">修改时间:</Text>
                              <Text>{formatDate(model.modified_at)}</Text>
                            </Flex>
                            {model.details?.parameter_size && (
                              <Flex justify="space-between">
                                <Text type="secondary">参数量:</Text>
                                <Text>{model.details.parameter_size}</Text>
                              </Flex>
                            )}
                          </Space>
                        </Card>
                      </ModelCard>
                    </Col>
                  ))}
                </Row>
              )}
            </Card>

            {/* 可下载模型 */}
            <Card
              title={
                <Flex align="center" gap={8}>
                  <Download size={18} />
                  可下载模型 ({uninstalledModels.length})
                </Flex>
              }>
              {uninstalledModels.length === 0 ? (
                <Empty description="所有可用模型已安装完成" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <Row gutter={[16, 16]}>
                  {uninstalledModels.map((model) => {
                    const isDownloading = downloadingModels.has(model.name)
                    const progress = downloadProgress.get(model.name)

                    return (
                      <Col span={12} key={model.name}>
                        <Card
                          size="small"
                          title={
                            <Flex align="center" justify="space-between">
                              <Text strong>{model.name}</Text>
                              <Space>
                                {model.tags.map((tag) => (
                                  <Tag key={tag}>{tag}</Tag>
                                ))}
                              </Space>
                            </Flex>
                          }
                          actions={[
                            isDownloading ? (
                              <Flex align="center" justify="center" gap={8}>
                                <Button
                                  type="default"
                                  size="small"
                                  icon={<X size={14} />}
                                  onClick={() => cancelDownload(model.name)}
                                  danger>
                                  取消
                                </Button>
                              </Flex>
                            ) : (
                              <Button
                                type="primary"
                                size="small"
                                icon={<CloudDownloadOutlined />}
                                onClick={() => downloadModel(model.name)}
                                disabled={!isConnected}>
                                下载
                              </Button>
                            )
                          ]}>
                          <Space direction="vertical" size="small" style={{ width: '100%' }}>
                            <Paragraph style={{ margin: 0, fontSize: '12px' }} type="secondary">
                              {model.description}
                            </Paragraph>
                            <Flex justify="space-between">
                              <Text type="secondary">大小:</Text>
                              <Text>{model.size}</Text>
                            </Flex>
                            {isDownloading && progress && (
                              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                <Progress
                                  percent={getDownloadPercentage(progress)}
                                  status={getProgressStatus(progress.status)}
                                  size="small"
                                  showInfo={false}
                                />
                                <Text style={{ fontSize: '12px' }} type="secondary">
                                  {formatProgressText(progress)}
                                </Text>
                              </Space>
                            )}
                          </Space>
                        </Card>
                      </Col>
                    )
                  })}
                </Row>
              )}
            </Card>
          </ContentWrapper>
        </Scrollbar>
      </MainContent>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  background: var(--color-background);
`

const MainContent = styled.div`
  flex: 1;
  overflow-y: auto;
  min-height: 0;
`

const ContentWrapper = styled.div`
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
`

const ModelCard = styled.div`
  .ant-card {
    height: 100%;
  }
`

export default OllamaPage
