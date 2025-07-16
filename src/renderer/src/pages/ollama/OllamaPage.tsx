import { CloudDownloadOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { useProvider } from '@renderer/hooks/useProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import ollamaDownloadService from '@renderer/services/OllamaDownloadService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setOllamaKeepAliveTime } from '@renderer/store/llm'
import { Model } from '@renderer/types'
import { getDefaultGroupName } from '@renderer/utils'
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
import { isEmpty } from 'lodash'
import { CheckCircle, Download, RefreshCw, Settings, Trash2, X } from 'lucide-react'
import { Component, ErrorInfo, FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

const { Text, Paragraph } = Typography

// 获取已安装模型的显示名称（优先使用 showname，从 JSON 中查找）
const getInstalledModelDisplayName = (installedModelName: string, availableModels: AvailableModel[]): string => {
  // 在可下载模型列表中查找匹配的模型
  const matchedModel = availableModels.find((availableModel) => {
    // 精确匹配或前缀匹配（处理标签版本）
    return installedModelName === availableModel.name || installedModelName.startsWith(`${availableModel.name}:`)
  })

  // 如果找到匹配的模型，返回 showname，否则使用默认处理
  if (matchedModel) {
    return matchedModel.showname
  }

  // 如果没有匹配的模型，使用默认的处理逻辑
  const lastSlashIndex = installedModelName.lastIndexOf('/')
  let modelName = lastSlashIndex !== -1 ? installedModelName.substring(lastSlashIndex + 1) : installedModelName

  // 去掉常见的后缀
  const suffixesToRemove = ['-GGUF', '-Instruct-GGUF', '-Chat-GGUF', '-Code-GGUF']

  for (const suffix of suffixesToRemove) {
    if (modelName.endsWith(suffix)) {
      modelName = modelName.substring(0, modelName.length - suffix.length)
      break
    }
  }

  // 如果还有 -Instruct 后缀，也去掉
  if (modelName.endsWith('-Instruct')) {
    modelName = modelName.substring(0, modelName.length - '-Instruct'.length)
  }

  return modelName
}

// 错误边界组件
class ErrorBoundary extends Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('OllamaPage Error Boundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <Alert
              message="页面渲染出错"
              description="页面遇到了一些问题，请刷新页面重试。"
              type="error"
              showIcon
              action={
                <Button size="small" onClick={() => window.location.reload()}>
                  刷新页面
                </Button>
              }
            />
          </div>
        )
      )
    }

    return this.props.children
  }
}

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
  showname: string // 显示名称
  name: string // 实际的模型标识符
  description: string
  tags: string[]
  size: string
  pullable: boolean
  source: string
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

  // 添加安全的 provider 获取
  const ollamaProviderHook = useProvider('ollama')
  const localProviderHook = useProvider('local')

  const { provider: ollamaProvider, updateProvider } = ollamaProviderHook
  const { provider: localProvider, addModel: addModelToLocal } = localProviderHook
  const { settings, downloads = { downloading: [], progress: {} } } = useAppSelector((state) => state.llm)

  // 从全局状态获取下载信息
  const { downloading: downloadingModels = [], progress: downloadProgress = {} } = downloads

  // 安全的状态初始化
  const [installedModels, setInstalledModels] = useState<OllamaModel[]>([])
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [loading, setLoading] = useState(false)
  const [apiHost, setApiHost] = useState(ollamaProvider?.apiHost || 'http://localhost:11434')
  const [isConnected, setIsConnected] = useState(false)
  const [checkingConnection, setCheckingConnection] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [clickCount, setClickCount] = useState(0)
  const [clickTimeout, setClickTimeout] = useState<NodeJS.Timeout | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  // 使用 useRef 来追踪已同步的模型，避免依赖循环
  const syncedModelsRef = useRef<Set<string>>(new Set())

  // 使用 useRef 来追踪已完成下载的模型，避免重复提示
  const completedDownloadsRef = useRef<Set<string>>(new Set())

  // 渲染内容的包装器
  const renderWithErrorBoundary = useCallback((content: React.ReactNode) => {
    return <ErrorBoundary>{content}</ErrorBoundary>
  }, [])

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
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      const models = data.models || []

      setInstalledModels(models)

      // 模型同步逻辑已移至单独的函数中处理
    } catch (error) {
      console.error('Failed to fetch installed models:', error)
      setInstalledModels([]) // 确保有一个明确的状态
    } finally {
      setLoading(false)
    }
  }, [apiHost, isConnected]) // 移除 availableModels 依赖，避免循环依赖

  // 同步已安装模型到本地模型库（只同步JSON中定义的模型）
  useEffect(() => {
    // 只在两个数据源都准备好时才开始同步
    if (installedModels.length === 0 || availableModels.length === 0) {
      return
    }

    // 遍历已安装的模型
    installedModels.forEach((installedModel) => {
      const modelId = installedModel.name
      if (!modelId || isEmpty(modelId)) {
        console.warn('⚠️ 无效的 Ollama 模型:', installedModel)
        return
      }

      // 检查该模型是否在 JSON 中定义
      const matchedJsonModel = availableModels.find((jsonModel) => {
        // 精确匹配或前缀匹配（处理标签版本，如 model:latest）
        return modelId === jsonModel.name || modelId.startsWith(`${jsonModel.name}:`)
      })

      if (!matchedJsonModel) {
        return // 不在 JSON 中定义的模型，跳过同步
      }

      // 检查是否已经同步过
      if (syncedModelsRef.current.has(modelId)) {
        return
      }

      // 只同步 JSON 中定义的模型
      if (localProvider?.models && addModelToLocal) {
        const existingModel = localProvider.models.find((m) => m?.id === modelId)

        const newModel: Model = {
          id: modelId,
          name: matchedJsonModel.showname, // 使用 JSON 中定义的显示名称
          provider: 'local',
          group: getDefaultGroupName(modelId, 'local'),
          description: `Ollama 本地模型${installedModel.details?.parameter_size ? ` - ${installedModel.details.parameter_size}` : ''}`,
          owned_by: 'ollama'
        }

        if (!existingModel) {
          // 模型不存在，添加新模型
          addModelToLocal(newModel)
          syncedModelsRef.current.add(modelId)
        } else {
          // 模型已存在，检查是否需要更新显示名称
          if (existingModel.name !== newModel.name) {
            localProviderHook.removeModel?.(existingModel)
            addModelToLocal(newModel)
          }
          syncedModelsRef.current.add(modelId)
        }
      }
    })
  }, [installedModels, availableModels, localProvider, addModelToLocal, localProviderHook])

  // 获取可下载的模型列表
  const fetchAvailableModels = useCallback(async () => {
    try {
      if (!resourcesPath) {
        return
      }

      const modelsData = await window.api.fs.read(`${resourcesPath}/data/ollama-models.json`, 'utf-8')
      const models: AvailableModel[] = JSON.parse(modelsData)
      setAvailableModels(models)

      // 将可用模型数据传递给下载服务，用于显示 showname
      ollamaDownloadService.setAvailableModels(models)
    } catch (error) {
      console.error('Failed to load local models from JSON:', error)
      // 如果读取文件失败，使用默认的空数组
      setAvailableModels([])
    }
  }, [resourcesPath])

  // 取消下载
  const cancelDownload = useCallback((modelName: string) => {
    ollamaDownloadService.cancelDownload(modelName)
  }, [])

  // 下载模型
  const downloadModel = useCallback(
    async (modelName: string) => {
      await ollamaDownloadService.downloadModel(modelName, apiHost)
      // 下载完成后刷新已安装模型列表
      setTimeout(() => {
        fetchInstalledModels()
      }, 500)
    },
    [apiHost, fetchInstalledModels]
  )

  // 删除模型
  const deleteModel = useCallback(
    async (modelName: string) => {
      try {
        setLoading(true) // 添加删除时的加载状态
        const response = await fetch(`${apiHost}/api/delete`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modelName })
        })

        if (response.ok) {
          // 使用 showname 显示删除成功提示
          const displayName = getInstalledModelDisplayName(modelName, availableModels)
          window.message.success(`模型 ${displayName} 删除成功`)
          fetchInstalledModels()

          // 从 local provider 中移除对应的模型
          if (localProvider?.models && localProviderHook.removeModel) {
            const modelToRemove = localProvider.models.find((m) => m.id === modelName)
            if (modelToRemove) {
              localProviderHook.removeModel(modelToRemove)
            }
          }

          // 同时从同步记录中移除模型
          syncedModelsRef.current.delete(modelName)
          // 清理下载完成记录
          completedDownloadsRef.current.delete(modelName)
        } else {
          throw new Error('Delete failed')
        }
      } catch (error) {
        console.error('Failed to delete model:', error)
        // 使用 showname 显示删除失败提示
        const displayName = getInstalledModelDisplayName(modelName, availableModels)
        window.message.error(`删除模型 ${displayName} 失败: ${error}`)
      } finally {
        setLoading(false)
      }
    },
    [apiHost, fetchInstalledModels, localProvider, localProviderHook]
  )

  // 更新 API Host
  const updateApiHost = useCallback(() => {
    if (ollamaProvider) {
      updateProvider({ ...ollamaProvider, apiHost })
    }
  }, [ollamaProvider, apiHost, updateProvider])

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

  // 过滤出在JSON中定义的已安装模型
  const jsonDefinedInstalledModels = useMemo(() => {
    const filtered = installedModels.filter((installedModel) => {
      // 检查已安装模型是否在JSON中定义
      return availableModels.some((jsonModel) => {
        // 精确匹配或前缀匹配（处理标签版本）
        return installedModel.name === jsonModel.name || installedModel.name.startsWith(`${jsonModel.name}:`)
      })
    })

    return filtered
  }, [installedModels, availableModels])

  // 过滤出未安装的可下载模型
  const uninstalledModels = availableModels.filter((model) => !isModelInstalled(model.name))

  // 如果有渲染错误，显示错误信息
  if (renderError) {
    return (
      <Container>
        <Navbar>
          <NavbarCenter style={{ borderRight: 'none' }}>
            <Flex align="center" gap={12}>
              <Text strong>本地模型管理</Text>
            </Flex>
          </NavbarCenter>
        </Navbar>
        <MainContent>
          <div style={{ padding: '24px' }}>
            <Alert
              message="页面部分功能异常"
              description={renderError}
              type="warning"
              showIcon
              action={<Button onClick={() => setRenderError(null)}>重试</Button>}
            />
          </div>
        </MainContent>
      </Container>
    )
  }

  // 主渲染逻辑
  return renderWithErrorBoundary(
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>
          <Flex align="center" gap={12}>
            <Text strong>本地模型管理</Text>
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
                        onChange={(value) => dispatch(setOllamaKeepAliveTime(value || 0))}
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
            {!showConfig && <div onClick={handleConfigIconClick} style={{ height: '10px', marginBottom: 24 }} />}

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
                    已安装模型 ({jsonDefinedInstalledModels.length})
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
              ) : jsonDefinedInstalledModels.length === 0 ? (
                <Empty description={'暂无已安装的模型'} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <Row gutter={[16, 16]}>
                  {jsonDefinedInstalledModels.map((model) => (
                    <Col span={12} key={model.name}>
                      <ModelCard>
                        <Card
                          size="small"
                          title={
                            <Flex align="center" justify="space-between">
                              <Text strong>{getInstalledModelDisplayName(model.name, availableModels)}</Text>
                              <Tooltip title="删除模型">
                                <Button
                                  type="text"
                                  size="small"
                                  danger
                                  icon={<Trash2 size={14} />}
                                  loading={loading}
                                  onClick={() => {
                                    const modelSize = formatSize(model.size)
                                    const modelInfo = model.details?.parameter_size || '未知参数量'

                                    window.modal.confirm({
                                      content: (
                                        <div>
                                          <p style={{ marginBottom: 12 }}>
                                            您确定要删除模型{' '}
                                            <strong>{getInstalledModelDisplayName(model.name, availableModels)}</strong>{' '}
                                            吗？
                                          </p>
                                          <div style={{ fontSize: '13px', color: '#666' }}>
                                            <div>• 模型大小: {modelSize}</div>
                                            <div>• 参数规模: {modelInfo}</div>
                                            <div>• 修改时间: {formatDate(model.modified_at)}</div>
                                          </div>
                                        </div>
                                      ),
                                      okText: '确认删除',
                                      cancelText: '取消',
                                      okType: 'danger',
                                      icon: null,
                                      centered: true,
                                      maskClosable: false,
                                      onOk: () => deleteModel(model.name),
                                      onCancel: () => {}
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
                    const isDownloading = downloadingModels.includes(model.name)
                    const progress = downloadProgress[model.name]

                    return (
                      <Col span={12} key={model.name}>
                        <Card
                          size="small"
                          title={
                            <Flex align="center" justify="space-between">
                              <Text strong>{model.showname}</Text>
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
