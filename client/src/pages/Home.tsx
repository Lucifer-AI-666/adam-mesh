import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import CosmicNebula, { type NebulaState } from "@/components/CosmicNebula";
import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  MessageSquare, Map, Shield, BarChart3, Clock, Zap,
  Send, Mic, MicOff, Volume2, ArrowRight, Activity,
  Users, FileText, Globe, X, Menu, ChevronDown
} from "lucide-react";
import { useNotifications, NOTIFICATION_MESSAGE_MAX_LENGTH } from "@/contexts/NotificationContext";

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const { addNotification } = useNotifications();
  const [nebulaState, setNebulaState] = useState<NebulaState>("idle");
  const [inputText, setInputText] = useState("");
  const [lastResponse, setLastResponse] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [conversationId, setConversationId] = useState<number | undefined>();
  const recognitionRef = useRef<any>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [audioCache, setAudioCache] = useState<Record<string, string>>({});
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioSpeed, setAudioSpeed] = useState(1);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Stats query
  const { data: stats } = trpc.analytics.stats.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30000,
  });

  // Gemini TTS mutation
  const speakMutation = trpc.chat.speak.useMutation({
    onSuccess: (data) => {
      if (data.audio) {
        const cacheKey = lastResponse.slice(0, 50);
        setAudioCache((prev) => ({ ...prev, [cacheKey]: data.audio }));
        setIsGeneratingAudio(false);
        setIsPlayingAudio(true);
        playGeminiAudio(data.audio);
        setTimeout(() => setIsPlayingAudio(false), 3000);
      } else {
        console.warn("[Gemini TTS] Audio non disponibile");
        setIsGeneratingAudio(false);
      }
    },
    onError: (err) => {
      console.warn("[Gemini TTS] Errore:", err.message);
      setIsGeneratingAudio(false);
    },
  });

  // Audio playback refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const playGeminiAudio = (base64Audio: string) => {
    try {
      if (!audioContextRef.current || audioContextRef.current.state === "closed") {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      }
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") ctx.resume();

      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) float32Array[i] = int16Array[i] / 32768;

      if (currentSourceRef.current) currentSourceRef.current.stop();
      const buffer = ctx.createBuffer(1, float32Array.length, 24000);
      buffer.getChannelData(0).set(float32Array);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = audioSpeed;
      source.connect(ctx.destination);
      source.start(0);
      currentSourceRef.current = source;
    } catch (err) {
      console.error("[Audio] Errore playback:", err);
    }
  };

  // Chat send mutation
  const sendMutation = trpc.chat.send.useMutation({
    onSuccess: (data) => {
      setConversationId(data.conversationId);
      setLastResponse(data.message);
      setShowResponseModal(true);
      setNebulaState("idle");
      if (data.riskLevel === "red") {
        addNotification(
          "escalation_red",
          "🔴 Escalation attivata",
          "La tua richiesta è stata inoltrata a un operatore umano."
        );
      } else {
        addNotification(
          "new_message",
          "Risposta da ADAM",
          data.message.slice(0, NOTIFICATION_MESSAGE_MAX_LENGTH) + (data.message.length > NOTIFICATION_MESSAGE_MAX_LENGTH ? "…" : "")
        );
      }
      if (data.responseType) {
        const colorMap: Record<string, NebulaState> = {
          "in-ascolto": "idle",
          "elaborazione": "purple",
          "informativo": "blue",
          "risposta-sicura": "green",
          "verifica-necessaria": "yellow",
          "attenzione": "orange",
          "escalation": "red",
          "empatico": "pink",
          "creativo": "indigo",
          "importante": "gold",
        };
        setNebulaState(colorMap[data.responseType] || "idle");
        setTimeout(() => setNebulaState("idle"), 10000);
      }
      setTimeout(() => {
        const cacheKey = data.message.slice(0, 100);
        if (audioCache[cacheKey]) {
          setIsPlayingAudio(true);
          playGeminiAudio(audioCache[cacheKey]);
          setTimeout(() => setIsPlayingAudio(false), 3000);
        } else {
          setIsGeneratingAudio(true);
          speakMutation.mutate({ text: data.message });
        }
      }, 500);
    },
    onError: (err) => {
      console.error("[Chat] Errore:", err.message);
      setNebulaState("idle");
    },
  });

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Voice input
  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = "it-IT";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => { setIsListening(true); setNebulaState("purple"); };
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setInputText(transcript);
    };
    recognition.onend = () => { setIsListening(false); if (!sendMutation.isPending) setNebulaState("idle"); };
    recognition.onerror = () => { setIsListening(false); setNebulaState("idle"); };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setIsListening(false);
  };

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    sendMutation.mutate({ conversationId, message: text });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleInstantLogin = () => { window.location.href = getLoginUrl(); };

  const timeStr = currentTime.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = currentTime.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" }).toUpperCase();

  if (isMobile) {
    return <HomeMobile {...{
      user, isAuthenticated, stats, nebulaState, inputText, setInputText,
      lastResponse, setLastResponse, isListening, startListening, stopListening,
      handleSend, handleKeyDown, handleInstantLogin, timeStr, dateStr,
      sendMutation, speakMutation, isGeneratingAudio, isPlayingAudio,
      audioSpeed, setAudioSpeed, audioCache, playGeminiAudio,
      mobileMenuOpen, setMobileMenuOpen, showResponseModal, setShowResponseModal
    }} />;
  }

  return (
    <div className="min-h-screen bg-[#030310] text-white overflow-hidden relative">
      {/* Background grid effect */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: "linear-gradient(rgba(0,220,220,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(0,220,220,0.3) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
      }} />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-[0.15em] text-primary font-mono">A.D.A.M.</h1>
          <span className="text-[10px] text-white/30 font-mono uppercase tracking-wider">
            Acqui Digital Administrative Mesh
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[10px] font-mono text-white/40">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              CORE
            </span>
            <span>·</span>
            <span>ONLINE</span>
            <span>·</span>
            <span>ALIVE</span>
          </div>
          <div className="text-right font-mono">
            <div className="text-xl text-white/90 tracking-wider">{timeStr}</div>
            <div className="text-[9px] text-white/30 tracking-widest">{dateStr}</div>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex h-[calc(100vh-65px)]">
        {/* Left Panel - Stats */}
        <aside className="w-64 border-r border-white/5 p-4 flex flex-col gap-4 overflow-y-auto">
          <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-1">
            System Vitals
          </div>

          {isAuthenticated && stats ? (
            <>
              <StatCard icon={<MessageSquare className="h-3 w-3" />} label="Conversazioni" value={stats.totalConversations?.toString() || "0"} />
              <StatCard icon={<Users className="h-3 w-3" />} label="Nodi Attivi" value={stats.totalNodes?.toString() || "0"} />
              <StatCard icon={<Shield className="h-3 w-3" />} label="Escalation" value={stats.pendingEscalations?.toString() || "0"} trend={(stats.pendingEscalations ?? 0) > 0 ? "alert" : "ok"} />
              <StatCard icon={<FileText className="h-3 w-3" />} label="Knowledge Base" value={stats.knowledgeEntries?.toString() || "0"} />
              <StatCard icon={<Activity className="h-3 w-3" />} label="Messaggi Oggi" value={stats.todayMessages?.toString() || "0"} />
            </>
          ) : (
            <div className="text-[10px] text-white/30 font-mono">Accedi per vedere le statistiche</div>
          )}

          <div className="mt-4 border-t border-white/5 pt-4">
            <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-2">
              Navigazione
            </div>
            <div className="space-y-1.5">
              <NavBtn href="/chat" icon={<MessageSquare className="h-3 w-3" />} label="Chat" />
              <NavBtn href="/map" icon={<Map className="h-3 w-3" />} label="Mappa" />
              <NavBtn href="/dashboard" icon={<BarChart3 className="h-3 w-3" />} label="Analytics" />
            </div>
          </div>
        </aside>

        {/* Center - Nebula */}
        <main className="flex-1 flex flex-col items-center justify-center relative">
          <CosmicNebula state={nebulaState} size={420} />

          {/* Response preview - click to expand */}
          {lastResponse && (
            <div className="absolute bottom-44 left-1/2 -translate-x-1/2 max-w-2xl px-6 w-full">
              <button
                onClick={() => setShowResponseModal(true)}
                className="w-full bg-white/5 border border-white/10 rounded-lg p-4 backdrop-blur-sm hover:bg-white/10 hover:border-primary/30 transition-all text-left group"
              >
                <p className="text-sm text-white/70 font-mono leading-relaxed line-clamp-3">
                  {lastResponse}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[9px] text-white/30">Clicca per leggere tutto</span>
                  <ChevronDown className="h-3 w-3 text-white/30 group-hover:text-primary/60" />
                </div>
              </button>
            </div>
          )}

          {/* Response Modal */}
          {showResponseModal && lastResponse && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <div className="bg-white/5 border border-white/10 rounded-lg max-w-2xl w-full max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-white/5">
                  <h3 className="text-sm font-mono text-white/70">Risposta Completa</h3>
                  <button
                    onClick={() => setShowResponseModal(false)}
                    className="p-1 hover:bg-white/10 rounded transition-all"
                  >
                    <X className="h-4 w-4 text-white/50" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <p className="text-sm text-white/70 font-mono leading-relaxed whitespace-pre-wrap">
                    {lastResponse}
                  </p>
                </div>
                <div className="border-t border-white/5 p-4 flex items-center justify-center gap-3 flex-wrap">
                  <button
                    onClick={() => {
                      const cacheKey = lastResponse.slice(0, 50);
                      if (audioCache[cacheKey]) {
                        setIsPlayingAudio(true);
                        playGeminiAudio(audioCache[cacheKey]);
                        setTimeout(() => setIsPlayingAudio(false), 3000);
                      } else {
                        setIsGeneratingAudio(true);
                        speakMutation.mutate({ text: lastResponse });
                      }
                    }}
                    disabled={isGeneratingAudio || speakMutation.isPending}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-white/50 border border-white/10 rounded-full hover:border-primary/50 hover:text-primary transition-all disabled:opacity-30"
                  >
                    {isGeneratingAudio || speakMutation.isPending ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        Generando...
                      </>
                    ) : isPlayingAudio ? (
                      <>
                        <Volume2 className="h-3 w-3" />
                        Riproducendo...
                      </>
                    ) : (
                      <>
                        <Volume2 className="h-3 w-3" />
                        Riascolta
                      </>
                    )}
                  </button>
                  <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-white/30 border border-white/10 rounded-full">
                    <span>Velocità:</span>
                    {[1, 1.5, 2].map((speed) => (
                      <button
                        key={speed}
                        onClick={() => setAudioSpeed(speed)}
                        className={`px-1.5 py-0.5 rounded transition-all ${
                          audioSpeed === speed
                            ? "bg-primary/20 text-primary border border-primary/30"
                            : "text-white/40 hover:text-white/60"
                        }`}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Suggested questions */}
          {!lastResponse && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 w-full max-w-2xl px-6">
              <div className="flex flex-wrap justify-center gap-2">
                {[
                  "Cos'è La Bollente?",
                  "Dove mangio stasera?",
                  "Parlami in dialetto acquese",
                  "Cosa visitare ad Acqui?",
                  "Orari ufficio anagrafe",
                  "Raccontami la storia romana",
                  "Che vino mi consigli?",
                  "Eventi di questo mese",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      if (!isAuthenticated) { window.location.href = getLoginUrl(); return; }
                      setInputText(q); setTimeout(() => { sendMutation.mutate({ conversationId, message: q }); }, 100);
                    }}
                    disabled={sendMutation.isPending}
                    className="px-3 py-1.5 text-[11px] font-mono text-white/50 border border-white/10 rounded-full hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all duration-200 disabled:opacity-30"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {lastResponse && isAuthenticated && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2">
              <button
                onClick={() => setLastResponse("")}
                className="px-3 py-1.5 text-[10px] font-mono text-white/30 border border-white/5 rounded-full hover:border-primary/30 hover:text-primary/60 transition-all"
              >
                ↺ Altre domande
              </button>
            </div>
          )}

          {/* Input bar at bottom */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-xl px-6">
            {isAuthenticated ? (
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-2 backdrop-blur-sm">
                <button
                  onClick={isListening ? stopListening : startListening}
                  className={`p-2 rounded-full transition-all ${isListening ? "bg-red-500/20 text-red-400 animate-pulse" : "text-white/40 hover:text-primary"}`}
                >
                  {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isListening ? "Sto ascoltando..." : "Parla con ADAM..."}
                  className="flex-1 bg-transparent text-sm text-white/90 placeholder:text-white/20 focus:outline-none font-mono"
                />
                <button
                  onClick={handleSend}
                  disabled={!inputText.trim() || sendMutation.isPending}
                  className="p-2 rounded-full text-primary hover:bg-primary/10 transition-all disabled:opacity-30"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={handleInstantLogin}
                className="w-full flex items-center justify-center gap-3 bg-primary/10 border border-primary/30 rounded-full px-6 py-3 text-primary hover:bg-primary/20 transition-all font-mono text-sm"
              >
                <Zap className="h-4 w-4" />
                Entra in ADAM — 1 Click
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </main>

        {/* Right Panel - Commands & Info */}
        <aside className="w-64 border-l border-white/5 p-4 flex flex-col gap-4 overflow-y-auto">
          <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-1">
            Command Deck
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <CmdBtn label="Chat" onClick={() => window.location.href = "/chat"} />
            <CmdBtn label="Mappa" onClick={() => window.location.href = "/map"} />
            <CmdBtn label="Nodi" onClick={() => window.location.href = "/admin/nodes"} />
            <CmdBtn label="Escalation" onClick={() => window.location.href = "/escalations"} />
            <CmdBtn label="Analytics" onClick={() => window.location.href = "/dashboard"} />
            <CmdBtn label="Knowledge" onClick={() => window.location.href = "/admin/knowledge"} />
            <CmdBtn label="Settings" onClick={() => window.location.href = "/admin/settings"} />
          </div>

          {/* Color legend */}
          <div className="mt-4 border-t border-white/5 pt-4">
            <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-2">
              Spettro Risposte
            </div>
            <div className="space-y-1.5">
              <ColorLegend color="rgb(0, 220, 220)" label="In Ascolto" />
              <ColorLegend color="rgb(160, 100, 255)" label="Elaborazione" />
              <ColorLegend color="rgb(60, 140, 255)" label="Informativo" />
              <ColorLegend color="rgb(0, 255, 120)" label="Risposta Sicura" />
              <ColorLegend color="rgb(255, 210, 0)" label="Verifica Necessaria" />
              <ColorLegend color="rgb(255, 140, 30)" label="Attenzione" />
              <ColorLegend color="rgb(255, 50, 50)" label="Escalation" />
              <ColorLegend color="rgb(255, 100, 180)" label="Empatico" />
              <ColorLegend color="rgb(100, 60, 220)" label="Creativo" />
              <ColorLegend color="rgb(255, 200, 50)" label="Importante" />
            </div>
          </div>

          {/* User info */}
          {isAuthenticated && user && (
            <div className="mt-4 border-t border-white/5 pt-4">
              <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-2">
                Operatore
              </div>
              <div className="text-[10px] text-white/60 font-mono">
                <div>{user.name}</div>
                <div className="text-white/40">{user.email}</div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// Mobile version
function HomeMobile({ user, isAuthenticated, stats, nebulaState, inputText, setInputText, lastResponse, setLastResponse, isListening, startListening, stopListening, handleSend, handleKeyDown, handleInstantLogin, timeStr, dateStr, sendMutation, speakMutation, isGeneratingAudio, setIsGeneratingAudio, isPlayingAudio, setIsPlayingAudio, audioSpeed, setAudioSpeed, audioCache, playGeminiAudio, mobileMenuOpen, setMobileMenuOpen, showResponseModal, setShowResponseModal }: any) {
  return (
    <div className="min-h-screen bg-[#030310] text-white flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="border-b border-white/5 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-primary font-mono">A.D.A.M.</h1>
        </div>
        <div className="text-right font-mono text-[10px]">
          <div className="text-white/90">{timeStr}</div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center relative px-4 pb-24">
        <CosmicNebula state={nebulaState} size={240} />

        {/* Response preview */}
        {lastResponse && (
          <button
            onClick={() => setShowResponseModal(true)}
            className="mt-6 w-full bg-white/5 border border-white/10 rounded-lg p-3 backdrop-blur-sm hover:bg-white/10 transition-all text-left"
          >
            <p className="text-xs text-white/70 font-mono line-clamp-3">
              {lastResponse}
            </p>
            <span className="text-[8px] text-white/30 mt-1 block">Clicca per leggere tutto</span>
          </button>
        )}

        {/* Response Modal */}
        {showResponseModal && lastResponse && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-white/5 border border-white/10 rounded-t-lg w-full max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between p-3 border-b border-white/5">
                <h3 className="text-xs font-mono text-white/70">Risposta Completa</h3>
                <button
                  onClick={() => setShowResponseModal(false)}
                  className="p-1 hover:bg-white/10 rounded"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <p className="text-xs text-white/70 font-mono leading-relaxed whitespace-pre-wrap">
                  {lastResponse}
                </p>
              </div>
              <div className="border-t border-white/5 p-3 flex gap-2 flex-wrap">
                <button
                  onClick={() => {
                    const cacheKey = lastResponse.slice(0, 50);
                    if (audioCache[cacheKey]) {
                      setIsPlayingAudio(true);
                      playGeminiAudio(audioCache[cacheKey]);
                      setTimeout(() => setIsPlayingAudio(false), 3000);
                    } else {
                      setIsGeneratingAudio(true);
                      speakMutation.mutate({ text: lastResponse });
                    }
                  }}
                  disabled={isGeneratingAudio || speakMutation.isPending}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[9px] font-mono text-white/50 border border-white/10 rounded-full hover:border-primary/50 hover:text-primary transition-all disabled:opacity-30"
                >
                  <Volume2 className="h-3 w-3" />
                  Riascolta
                </button>
                <div className="flex items-center gap-1 px-2 py-1.5 text-[9px] font-mono text-white/30 border border-white/10 rounded-full">
                  {[1, 1.5, 2].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => setAudioSpeed(speed)}
                      className={`px-1 py-0.5 rounded text-[8px] ${
                        audioSpeed === speed ? "bg-primary/20 text-primary" : "text-white/40"
                      }`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Suggested questions */}
        {!lastResponse && (
          <div className="mt-6 w-full flex flex-col gap-2">
            {[
              "Cos'è La Bollente?",
              "Dove mangio stasera?",
              "Parlami in dialetto acquese",
              "Cosa visitare ad Acqui?",
            ].map((q) => (
              <button
                key={q}
                onClick={() => {
                  if (!isAuthenticated) { window.location.href = getLoginUrl(); return; }
                  setInputText(q); setTimeout(() => { sendMutation.mutate({ conversationId: undefined, message: q }); }, 100);
                }}
                className="px-3 py-2 text-[10px] font-mono text-white/50 border border-white/10 rounded-lg hover:border-primary/50 hover:text-primary transition-all"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </main>

      {/* Bottom input */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-white/5 bg-[#030310] p-3">
        {isAuthenticated ? (
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-2">
            <button
              onClick={isListening ? stopListening : startListening}
              className={`p-1.5 rounded-full transition-all ${isListening ? "bg-red-500/20 text-red-400" : "text-white/40"}`}
            >
              {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Parla con ADAM..."
              className="flex-1 bg-transparent text-sm text-white/90 placeholder:text-white/20 focus:outline-none font-mono"
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim() || sendMutation.isPending}
              className="p-1.5 text-primary hover:bg-primary/10 transition-all disabled:opacity-30"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={handleInstantLogin}
            className="w-full flex items-center justify-center gap-2 bg-primary/10 border border-primary/30 rounded-full px-4 py-2 text-primary text-sm font-mono"
          >
            <Zap className="h-4 w-4" />
            Entra
          </button>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, trend }: any) {
  return (
    <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-white/40">
          {icon}
          <span className="text-[8px] font-mono uppercase tracking-wider">{label}</span>
        </div>
        {trend === "alert" && <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
      </div>
      <div className="text-xl font-mono text-white/80 font-bold">{value}</div>
    </div>
  );
}

function NavBtn({ href, icon, label }: any) {
  return (
    <Link href={href} className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono text-white/40 border border-white/5 rounded-lg hover:border-primary/30 hover:text-primary/60 transition-all">
      {icon}
      <span>{label}</span>
    </Link>
  );
}

function CmdBtn({ label, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1.5 text-[9px] font-mono text-white/40 border border-white/5 rounded-lg hover:border-primary/30 hover:text-primary/60 transition-all"
    >
      {label}
    </button>
  );
}

function ColorLegend({ color, label }: any) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[9px] text-white/40 font-mono">{label}</span>
    </div>
  );
}
