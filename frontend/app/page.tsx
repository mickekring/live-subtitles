'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Play, Square, Settings, Loader2, Download } from 'lucide-react'

interface Subtitle {
  text: string
  timestamp: number
  id: string
  isInstant?: boolean
}

interface SettingsState {
  model: 'tiny' | 'base' | 'small' | 'medium' | 'large'
  vadSensitivity: number
  instantSubtitles: boolean
  enableTranslation: boolean
  targetLanguage: string
  ollamaModel: string
}

export default function Home() {
  const [isRecording, setIsRecording] = useState(false)
  const [subtitles, setSubtitles] = useState<Subtitle[]>([])
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [modelReady, setModelReady] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [isLoadingModel, setIsLoadingModel] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<{
    percentage: number
    status: string
    downloaded?: string
    total?: string
  } | null>(null)
  const [settings, setSettings] = useState<SettingsState>({
    model: 'small',
    vadSensitivity: 3,
    instantSubtitles: false,
    enableTranslation: false,
    targetLanguage: 'english',
    ollamaModel: ''
  })
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [isTranslating, setIsTranslating] = useState(false)
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const websocketRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null)
  const subtitleIdRef = useRef(0)
  const streamRef = useRef<MediaStream | null>(null)
  const subtitlesContainerRef = useRef<HTMLDivElement | null>(null)
  const translationsContainerRef = useRef<HTMLDivElement | null>(null)

  const translateText = async (text: string, subtitleId: string) => {
    if (!settings.enableTranslation || !text || !settings.ollamaModel) return
    
    setIsTranslating(true)
    try {
      const response = await fetch(
        `http://localhost:8000/translate?text=${encodeURIComponent(text)}&target_language=${settings.targetLanguage}&model=${settings.ollamaModel}`,
        { method: 'POST' }
      )
      
      if (response.ok) {
        const data = await response.json()
        if (data.status === 'success') {
          setTranslations(prev => ({
            ...prev,
            [subtitleId]: data.translation
          }))
        }
      }
    } catch (error) {
      console.error('Translation error:', error)
    } finally {
      setIsTranslating(false)
    }
  }

  const connectWebSocket = useCallback(() => {
    if (websocketRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    setConnectionStatus('connecting')
    const ws = new WebSocket(`ws://localhost:8000/ws/transcribe?model=${settings.model}&vad=${settings.vadSensitivity}&instant=${settings.instantSubtitles}`)
    
    ws.onopen = () => {
      console.log('WebSocket connected')
      setConnectionStatus('connected')
      setIsLoadingModel(false)
    }
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.type === 'transcription') {
        const isInstant = message.mode === 'instant'
        const newSubtitle: Subtitle = {
          text: message.data.text,
          timestamp: Date.now(),
          id: `subtitle-${subtitleIdRef.current++}`,
          isInstant
        }
        
        // Keep more history when not translating (5), less when translating (3)
        const maxSubtitles = settings.enableTranslation ? 3 : 5
        
        if (isInstant) {
          // For instant subtitles, just add them
          setSubtitles(prev => [...prev, newSubtitle].slice(-maxSubtitles))
        } else {
          // For final subtitles, replace any instant ones from the same timeframe
          setSubtitles(prev => {
            // Remove recent instant subtitles (within last 3 seconds)
            const now = Date.now()
            const filtered = prev.filter(s => !s.isInstant || (now - s.timestamp > 3000))
            return [...filtered, newSubtitle].slice(-maxSubtitles)
          })
          
          // Trigger translation for final transcriptions
          if (settings.enableTranslation && !isInstant) {
            translateText(message.data.text, newSubtitle.id)
          }
        }
      } else if (message.type === 'model_loading') {
        setIsLoadingModel(true)
      } else if (message.type === 'model_loaded') {
        setIsLoadingModel(false)
      }
    }
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      setConnectionStatus('disconnected')
      setIsLoadingModel(false)
    }
    
    ws.onclose = () => {
      console.log('WebSocket disconnected')
      setConnectionStatus('disconnected')
      setIsLoadingModel(false)
    }
    
    websocketRef.current = ws
  }, [settings, translateText])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      })
      
      streamRef.current = stream
      connectWebSocket()
      
      audioContextRef.current = new AudioContext({ sampleRate: 16000 })
      
      // Load the AudioWorklet module
      await audioContextRef.current.audioWorklet.addModule('/audio-processor.js')
      
      // Create the worklet node
      audioWorkletNodeRef.current = new AudioWorkletNode(
        audioContextRef.current,
        'audio-processor'
      )
      
      // Handle messages from the worklet
      audioWorkletNodeRef.current.port.onmessage = (event) => {
        if (event.data.type === 'audio' && websocketRef.current?.readyState === WebSocket.OPEN) {
          websocketRef.current.send(event.data.data.buffer)
        }
      }
      
      // Connect the audio graph
      const source = audioContextRef.current.createMediaStreamSource(stream)
      source.connect(audioWorkletNodeRef.current)
      audioWorkletNodeRef.current.connect(audioContextRef.current.destination)
      
      setIsRecording(true)
      setSubtitles([]) // Clear old subtitles when starting
    } catch (error) {
      console.error('Error starting recording:', error)
      alert('Kunde inte komma åt mikrofonen. Se till att du har gett tillåtelse.')
    }
  }

  const stopRecording = () => {
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect()
      audioWorkletNodeRef.current = null
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    
    if (websocketRef.current) {
      websocketRef.current.close()
      websocketRef.current = null
    }
    
    setIsRecording(false)
    setConnectionStatus('disconnected')
  }

  // No longer needed - we limit subtitles to last 3 directly
  // useEffect(() => {
  //   const interval = setInterval(() => {
  //     setSubtitles(prev => {
  //       const now = Date.now()
  //       return prev.filter(s => now - s.timestamp < 15000) // Keep subtitles for 15 seconds
  //     })
  //   }, 1000)
  //   
  //   return () => clearInterval(interval)
  // }, [])

  // Check model status on mount and periodically
  useEffect(() => {
    const checkModelStatus = async () => {
      try {
        const response = await fetch(`http://localhost:8000/model-status?model=${settings.model}`)
        if (response.ok) {
          const data = await response.json()
          setModelReady(data.is_loaded)
        }
      } catch (error) {
        console.error('Failed to check model status:', error)
        setModelReady(false)
      }
    }

    // Check immediately
    checkModelStatus()
    
    // Check every 2 seconds to update status
    const interval = setInterval(checkModelStatus, 2000)
    
    return () => clearInterval(interval)
  }, [settings.model])

  // Fetch Ollama models on mount
  useEffect(() => {
    const fetchOllamaModels = async () => {
      try {
        const response = await fetch('http://localhost:8000/ollama-models')
        if (response.ok) {
          const data = await response.json()
          if (data.status === 'success' && data.models.length > 0) {
            setOllamaModels(data.models)
            // Set first model as default if not set
            if (!settings.ollamaModel && data.models.length > 0) {
              setSettings(prev => ({ ...prev, ollamaModel: data.models[0] }))
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch Ollama models:', error)
      }
    }
    
    fetchOllamaModels()
  }, [])

  useEffect(() => {
    return () => {
      stopRecording()
    }
  }, [])

  // Auto-scroll to bottom when new subtitles are added
  useEffect(() => {
    if (subtitlesContainerRef.current) {
      subtitlesContainerRef.current.scrollTop = subtitlesContainerRef.current.scrollHeight
    }
    if (translationsContainerRef.current) {
      translationsContainerRef.current.scrollTop = translationsContainerRef.current.scrollHeight
    }
  }, [subtitles, translations])

  const handleSettingsChange = async (newSettings: SettingsState) => {
    const modelChanged = newSettings.model !== settings.model
    
    if (modelChanged) {
      setIsLoadingModel(true)
      setModelReady(false)  // Model not ready while loading
      setDownloadProgress(null)
      if (isRecording) {
        stopRecording()
      }
      
      // Update settings first to show new selection
      setSettings(newSettings)
      
      // Check if model needs downloading
      try {
        const checkResponse = await fetch(`http://localhost:8000/check-model?model=${newSettings.model}`)
        const checkData = await checkResponse.json()
        
        // Start loading/downloading the model
        const loadResponse = await fetch(`http://localhost:8000/load-model?model=${newSettings.model}`, {
          method: 'POST'
        })
        
        if (!checkData.exists) {
          // Model needs downloading - show download status
          setDownloadProgress({
            percentage: 0,
            status: `Laddar ner ${newSettings.model} modell (${checkData.size})...`,
            downloaded: '',
            total: ''
          })
        }
        
        // Poll model-status endpoint to check when model is actually ready
        let statusInterval: NodeJS.Timeout | null = null
        let attempts = 0
        const maxAttempts = 600 // 5 minutes max (500ms intervals)
        
        const pollModelStatus = async () => {
          try {
            const statusResponse = await fetch(`http://localhost:8000/model-status?model=${newSettings.model}`)
            const statusData = await statusResponse.json()
            
            if (statusData.is_loaded) {
              // Model is ready!
              if (statusInterval) {
                clearInterval(statusInterval)
              }
              setDownloadProgress(null)
              setIsLoadingModel(false)
              setModelReady(true)  // Model is now ready
              console.log(`Model ${newSettings.model} is ready`)
            } else if (statusData.is_downloading) {
              // Still downloading - update message
              if (!downloadProgress) {
                setDownloadProgress({
                  percentage: 0,
                  status: `Laddar ner ${newSettings.model} modell...`,
                  downloaded: '',
                  total: ''
                })
              }
            }
            
            attempts++
            if (attempts >= maxAttempts) {
              // Timeout after 5 minutes
              if (statusInterval) {
                clearInterval(statusInterval)
              }
              setDownloadProgress(null)
              setIsLoadingModel(false)
              console.error('Model loading timeout')
            }
          } catch (error) {
            console.error('Failed to check model status:', error)
          }
        }
        
        // Start polling
        statusInterval = setInterval(pollModelStatus, 500)
        
        // Also poll immediately
        pollModelStatus()
        
      } catch (error) {
        console.error('Failed to load model:', error)
        setIsLoadingModel(false)
        setDownloadProgress(null)
      }
    } else {
      setSettings(newSettings)
      if (isRecording) {
        stopRecording()
        setTimeout(() => startRecording(), 100)
      }
    }
  }

  const getSubtitleStyle = (index: number, total: number) => {
    const position = index / Math.max(1, total - 1)
    const isLatest = index === total - 1
    
    // Reduce font sizes by 25% when translation is enabled
    const sizeFactor = settings.enableTranslation ? 0.75 : 1
    
    if (isLatest) {
      return {
        fontSize: `clamp(${2.2 * sizeFactor}rem, ${5 * sizeFactor}vw, ${4 * sizeFactor}rem)`,
        opacity: 1,
        fontWeight: 600
      }
    }
    
    const opacity = 0.3 + (position * 0.4) // Older text: 0.3-0.7 opacity
    const fontSize = `clamp(${1.7 * sizeFactor}rem, ${(3.5 + position * 0.8) * sizeFactor}vw, ${3 * sizeFactor}rem)`
    
    return {
      fontSize,
      opacity,
      fontWeight: 400
    }
  }

  const getModelDescription = (model: string) => {
    switch(model) {
      case 'tiny': return 'Snabbast (lägst noggrannhet)'
      case 'base': return 'Snabb'
      case 'small': return 'Balanserad'
      case 'medium': return 'Noggrann'
      case 'large': return 'Mest noggrann (långsammast)'
      default: return model
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white relative">
      {/* Control buttons in top right */}
      <div className="fixed top-4 right-4 z-10 flex items-center gap-2">
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={!modelReady || isLoadingModel}
          className={`p-3 rounded-full transition-all transform hover:scale-110 ${
            !modelReady || isLoadingModel 
              ? 'bg-gray-600 cursor-not-allowed'
              : isRecording 
                ? 'bg-red-600 hover:bg-red-700' 
                : 'bg-green-600 hover:bg-green-700'
          }`}
          aria-label={isRecording ? 'Stoppa' : 'Starta'}
        >
          {isLoadingModel ? (
            downloadProgress ? (
              <Download className="w-6 h-6 animate-pulse" />
            ) : (
              <Loader2 className="w-6 h-6 animate-spin" />
            )
          ) : isRecording ? (
            <Square className="w-6 h-6" />
          ) : (
            <Play className="w-6 h-6 ml-0.5" />
          )}
        </button>
        
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-3 rounded-full bg-gray-700 hover:bg-gray-600 transition-all transform hover:scale-110"
          aria-label="Inställningar"
        >
          <Settings className="w-6 h-6" />
        </button>
      </div>

      {/* Model status indicator */}
      <div className="fixed top-4 left-4 z-10 flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${
          modelReady ? 'bg-green-500' :
          isLoadingModel || downloadProgress ? 'bg-yellow-500 animate-pulse' :
          'bg-gray-500'
        }`} />
        <span className="text-xs text-gray-400">
          {modelReady ? `KB Whisper ${settings.model.charAt(0).toUpperCase() + settings.model.slice(1)} | Redo` :
           isLoadingModel || downloadProgress ? 'Laddar modell...' :
           'Modell ej redo'}
        </span>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-20" onClick={() => setShowSettings(false)}>
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-semibold mb-4">Inställningar</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Modell</label>
                <select
                  value={settings.model}
                  onChange={(e) => handleSettingsChange({ ...settings, model: e.target.value as SettingsState['model'] })}
                  disabled={isLoadingModel}
                  className="w-full p-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                >
                  <option value="tiny">Tiny - {getModelDescription('tiny')}</option>
                  <option value="base">Base - {getModelDescription('base')}</option>
                  <option value="small">Small - {getModelDescription('small')}</option>
                  <option value="medium">Medium - {getModelDescription('medium')}</option>
                  <option value="large">Large - {getModelDescription('large')}</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  Större modeller ger bättre noggrannhet men är långsammare
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">
                  VAD-känslighet: {settings.vadSensitivity}
                </label>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={settings.vadSensitivity}
                  onChange={(e) => handleSettingsChange({ ...settings, vadSensitivity: parseInt(e.target.value) })}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>Mindre känslig</span>
                  <span>Mer känslig</span>
                </div>
              </div>
              
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.instantSubtitles}
                    onChange={(e) => handleSettingsChange({ ...settings, instantSubtitles: e.target.checked })}
                    className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium">
                    Instant undertexter (Experimentell)
                  </span>
                </label>
                <p className="text-xs text-gray-400 mt-1 ml-6">
                  Visar ord direkt när de uttalas, sedan korrigeras de med mer exakt text
                </p>
              </div>
              
              <div className="border-t border-gray-600 pt-4">
                <h3 className="text-sm font-semibold mb-3">Översättning (via Ollama)</h3>
                
                <div className="space-y-3">
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.enableTranslation}
                        onChange={(e) => handleSettingsChange({ ...settings, enableTranslation: e.target.checked })}
                        className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium">
                        Aktivera översättning
                      </span>
                    </label>
                  </div>
                  
                  {settings.enableTranslation && (
                    <>
                      <div>
                        <label className="block text-sm font-medium mb-2">Målspråk</label>
                        <select
                          value={settings.targetLanguage}
                          onChange={(e) => handleSettingsChange({ ...settings, targetLanguage: e.target.value })}
                          className="w-full p-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                        >
                          <option value="english">English</option>
                          <option value="german">Tyska (Deutsch)</option>
                          <option value="italian">Italienska (Italiano)</option>
                          <option value="greek">Grekiska (Ελληνικά)</option>
                          <option value="french">Franska (Français)</option>
                          <option value="ukrainian">Ukrainska (Українська)</option>
                          <option value="chinese">Kinesiska (中文)</option>
                          <option value="japanese">Japanska (日本語)</option>
                          <option value="arabic">Arabiska (العربية)</option>
                        </select>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium mb-2">Ollama-modell</label>
                        {ollamaModels.length > 0 ? (
                          <select
                            value={settings.ollamaModel}
                            onChange={(e) => handleSettingsChange({ ...settings, ollamaModel: e.target.value })}
                            className="w-full p-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                          >
                            {ollamaModels.map(model => (
                              <option key={model} value={model}>{model}</option>
                            ))}
                          </select>
                        ) : (
                          <p className="text-xs text-red-400">
                            Ollama är inte igång eller inga modeller installerade
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            
            <button
              onClick={() => setShowSettings(false)}
              className="mt-6 w-full p-2 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            >
              Stäng
            </button>
          </div>
        </div>
      )}

      {/* Loading model overlay */}
      {(isLoadingModel || downloadProgress) && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 bg-gray-800 rounded-lg px-6 py-4 z-10">
          <div className="flex items-center gap-3">
            {downloadProgress?.status.includes('Laddar ner') ? (
              <Download className="w-5 h-5 animate-pulse text-blue-500" />
            ) : (
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            )}
            <span className="text-sm font-medium">
              {downloadProgress?.status || 'Laddar AI-modell...'}
            </span>
          </div>
        </div>
      )}

      {/* Main subtitle display area */}
      <div className="flex items-center justify-center min-h-screen p-8 md:p-16 lg:p-24">
        <div className={`w-full h-[80vh] ${settings.enableTranslation ? 'max-w-7xl' : 'max-w-6xl'}`}>
          {subtitles.length === 0 ? (
            <p className="text-gray-500 text-center text-xl">
              {isRecording ? 'Lyssnar...' : 
               'Klicka på play för att börja transkribera'}
            </p>
          ) : (
            <div className={`h-full ${settings.enableTranslation ? 'grid grid-cols-2 gap-8' : 'flex flex-col'}`}>
              {/* Original Swedish text */}
              <div className={`flex flex-col ${settings.enableTranslation ? 'border-r border-gray-700 pr-8' : ''} h-full`}>
                {settings.enableTranslation && (
                  <h3 className="text-sm text-gray-400 mb-4 font-semibold flex-shrink-0">Svenska</h3>
                )}
                <div className="overflow-y-auto flex-grow scroll-smooth" ref={subtitlesContainerRef}>
                  <div className="space-y-4 pb-8">
                    {subtitles.map((subtitle, index) => (
                      <div
                        key={subtitle.id}
                        className={`text-left transition-all duration-500 ease-out animate-fadeIn ${
                          subtitle.isInstant ? 'italic opacity-70' : ''
                        }`}
                        style={getSubtitleStyle(index, subtitles.length)}
                      >
                        {subtitle.text}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Translations */}
              {settings.enableTranslation && (
                <div className="flex flex-col h-full">
                  <h3 className="text-sm text-gray-400 mb-4 font-semibold flex-shrink-0">
                    {settings.targetLanguage.charAt(0).toUpperCase() + settings.targetLanguage.slice(1)}
                    {isTranslating && <span className="ml-2 text-xs">(översätter...)</span>}
                  </h3>
                  <div className="overflow-y-auto flex-grow scroll-smooth" ref={translationsContainerRef}>
                    <div className="space-y-4 pb-8">
                      {subtitles.map((subtitle, index) => (
                        <div
                          key={`trans-${subtitle.id}`}
                          className={`text-left transition-all duration-500 ease-out animate-fadeIn ${
                            subtitle.isInstant ? 'italic opacity-70' : ''
                          }`}
                          style={getSubtitleStyle(index, subtitles.length)}
                        >
                          {translations[subtitle.id] || (
                            !subtitle.isInstant && <span className="text-gray-600">...</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}