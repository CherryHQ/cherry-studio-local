import { CheckOutlined, CloudDownloadOutlined } from '@ant-design/icons'
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
  Row,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import { CheckCircle, Download, RefreshCw, Server, Settings, Trash2 } from 'lucide-react'
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

const OllamaPage: FC = () => {
  const dispatch = useAppDispatch()
  const { resourcesPath } = useRuntime()

  const { provider: ollamaProvider, updateProvider } = useProvider('ollama')
  const { settings } = useAppSelector((state) => state.llm)

  const [installedModels, setInstalledModels] = useState<OllamaModel[]>([])
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [loading, setLoading] = useState(false)
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set())
  const [apiHost, setApiHost] = useState(ollamaProvider?.apiHost || 'http://localhost:11434')
  const [isConnected, setIsConnected] = useState(false)
  const [checkingConnection, setCheckingConnection] = useState(false)

  // 检查 Ollama 连接状态
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
      console.error('Failed to load ollama models from JSON:', error)
      // 如果读取文件失败，使用默认的空数组
      setAvailableModels([])
    }
  }, [resourcesPath])

  // 下载模型
  const downloadModel = useCallback(
    async (modelName: string) => {
      setDownloadingModels((prev) => new Set(prev).add(modelName))

      try {
        const response = await fetch(`${apiHost}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modelName })
        })

        if (response.ok) {
          // 这里应该处理流式响应，显示下载进度
          // 为了简化，我们等待一段时间后刷新模型列表
          setTimeout(() => {
            fetchInstalledModels()
            setDownloadingModels((prev) => {
              const next = new Set(prev)
              next.delete(modelName)
              return next
            })
          }, 2000)

          window.message.success(`开始下载模型 ${modelName}`)
        } else {
          throw new Error('Download failed')
        }
      } catch (error) {
        console.error('Failed to download model:', error)
        window.message.error(`下载模型失败: ${error}`)
        setDownloadingModels((prev) => {
          const next = new Set(prev)
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

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>
          <Flex align="center" gap={12}>
            <Server size={20} />
            Ollama 本地模型管理
          </Flex>
        </NavbarCenter>
      </Navbar>

      <MainContent>
        <Scrollbar>
          <ContentWrapper>
            {/* 配置区域 */}
            <Card
              title={
                <Flex align="center" gap={8}>
                  <Settings size={18} />
                  基础配置
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

            {!isConnected && (
              <Alert
                message="无法连接到 Ollama 服务"
                description="请确保 Ollama 服务已启动，并检查 API 地址设置是否正确。"
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
                  可下载模型
                </Flex>
              }>
              <Row gutter={[16, 16]}>
                {availableModels.map((model) => {
                  const isInstalled = installedModels.some((m) => m.name.startsWith(model.name))
                  const isDownloading = downloadingModels.has(model.name)

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
                          isInstalled ? (
                            <Flex align="center" justify="center" gap={4} style={{ color: '#52c41a' }}>
                              <CheckOutlined />
                              已安装
                            </Flex>
                          ) : (
                            <Button
                              type="primary"
                              size="small"
                              icon={isDownloading ? <Spin size="small" /> : <CloudDownloadOutlined />}
                              onClick={() => downloadModel(model.name)}
                              loading={isDownloading}
                              disabled={!isConnected || isDownloading}>
                              {isDownloading ? '下载中...' : '下载'}
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
                        </Space>
                      </Card>
                    </Col>
                  )
                })}
              </Row>
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
