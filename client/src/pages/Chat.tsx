import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { useState, useRef, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useParams } from "wouter";
import { Mic, MicOff, Volume2, VolumeX, Send, Loader2, Bot, User } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { speechPieces } from "../../../shared/speechText";

function RiskBadge({ level }: { level?: string | null }) {
  if (!level) return null;
  const config = {
    green: { label: "Verde", className: "bg-[oklch(0.72_0.18_150)] text-black" },
    yellow: { label: "Giallo", className: "bg-[oklch(0.80_0.16_85)] text-black" },
    red: { label: "Rosso", className: "bg-[oklch(0.60_0.20_25)] text-white" },
  };
  const c = config[level as keyof typeof config];
  if (!c) return null;
  return <Badge className={cn("text-xs", c.className)}>{c.label}</Badge>;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  riskLevel?: string;
}

export default function Chat() {
  const params = useParams<{ id?: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<number | undefined>(
    params.id ? parseInt(params.id) : undefined
  );
  const [currentRisk, setCurrentRisk] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const speechQueueRef = useRef<string[]>([]);
  const speechTokenRef = useRef(0);
  const heardAudioRef = useRef(false);
  const speakNextRef = useRef<(token: number) => void>(() => {});

  const speakMutation = trpc.chat.speak.useMutation();

  const sendMutation = trpc.chat.send.useMutation({
    onSuccess: (data) => {
      setConversationId(data.conversationId);
      setCurrentRisk(data.riskLevel);
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: data.message, riskLevel: data.riskLevel },
      ]);
      if (ttsEnabled && data.message) {
        speakText(data.message);
      }
    },
  });

  // Load existing conversation messages
  const { data: existingMessages } = trpc.chat.getConversation.useQuery(
    { conversationId: conversationId! },
    { enabled: !!conversationId && messages.length === 0 }
  );

  useEffect(() => {
    if (existingMessages && messages.length === 0 && existingMessages.length > 0) {
      setMessages(existingMessages.filter(m => m.role !== "system").map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        riskLevel: m.riskLevel ?? undefined,
      })));
    }
  }, [existingMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cleanup audio context on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const playPcm = useCallback(async (base64Audio: string, onEnded: () => void) => {
    try {
      if (!audioContextRef.current || audioContextRef.current.state === "closed") {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      }
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") await ctx.resume();

      const binaryString = atob(base64Audio);
      const byteLength = binaryString.length - (binaryString.length % 2);
      const bytes = new Uint8Array(byteLength);
      for (let i = 0; i < byteLength; i++) bytes[i] = binaryString.charCodeAt(i);

      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) float32Array[i] = int16Array[i] / 32768.0;

      const audioBuffer = ctx.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => {
        if (currentSourceRef.current === source) currentSourceRef.current = null;
        onEnded();
      };
      currentSourceRef.current = source;
      source.start();
    } catch (error) {
      console.warn("[Voce] Errore playback:", error);
      onEnded();
    }
  }, []);

  const speakNext = useCallback((token: number) => {
    if (token !== speechTokenRef.current) return;
    const next = speechQueueRef.current.shift();
    if (!next) {
      setIsSpeaking(false);
      if (!heardAudioRef.current) {
        toast.info("Voce non disponibile al momento", { duration: 3000 });
      }
      return;
    }
    speakMutation.mutate(
      { text: next },
      {
        onSuccess: (data) => {
          if (token !== speechTokenRef.current) return;
          if (!data.audio) {
            speakNextRef.current(token);
            return;
          }
          heardAudioRef.current = true;
          playPcm(data.audio, () => speakNextRef.current(token));
        },
        onError: () => {
          if (token !== speechTokenRef.current) return;
          speakNextRef.current(token);
        },
      }
    );
  }, [playPcm, speakMutation]);

  speakNextRef.current = speakNext;

  const speakText = useCallback((text: string) => {
    const pieces = speechPieces(text);
    if (!pieces.length) return;
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch {}
      currentSourceRef.current = null;
    }
    speechTokenRef.current += 1;
    heardAudioRef.current = false;
    speechQueueRef.current = pieces;
    setIsSpeaking(true);
    speakNext(speechTokenRef.current);
  }, [speakNext]);

  const stopSpeaking = useCallback(() => {
    speechTokenRef.current += 1;
    speechQueueRef.current = [];
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch {}
      currentSourceRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  // ============ SPEECH-TO-TEXT (Web Speech API for input) ============
  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Il tuo browser non supporta il riconoscimento vocale. Usa Chrome o Edge.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "it-IT";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInputText(transcript);
    };

    recognition.onerror = (event: any) => {
      console.warn("[STT] Error:", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  }, []);

  // ============ SEND MESSAGE ============
  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setInputText("");
    sendMutation.mutate({ conversationId, message: text });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 container py-4 flex flex-col" style={{ height: "calc(100vh - 64px)" }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              <span className="text-primary">ADAM</span> Chat
            </h1>
            <p className="text-sm text-muted-foreground">Assistente civico di Acqui Terme</p>
          </div>
          <div className="flex items-center gap-3">
            {currentRisk && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Livello:</span>
                <RiskBadge level={currentRisk} />
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setTtsEnabled(!ttsEnabled);
                if (isSpeaking) stopSpeaking();
              }}
              className={cn(
                "transition-colors",
                ttsEnabled ? "text-primary" : "text-muted-foreground"
              )}
              title={ttsEnabled ? "Disattiva voce" : "Attiva voce"}
            >
              {ttsEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-card/50 p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="h-8 w-8 text-primary" />
              </div>
              <div>
                <p className="text-lg font-medium text-foreground">Ciao! Sono ADAM</p>
                <p className="text-sm text-muted-foreground mt-1">
                  L'assistente civico di Acqui Terme. Chiedimi qualsiasi cosa!
                </p>
                <p className="text-xs text-primary/70 mt-2 flex items-center justify-center gap-1">
                  <Volume2 className="h-3 w-3" /> Voce attiva
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md">
                {[
                  "Quali sono gli orari dell'anagrafe?",
                  "Come arrivo alle terme?",
                  "Dove posso parcheggiare in centro?",
                  "Quali eventi ci sono questo mese?",
                ].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => {
                      setInputText(prompt);
                      textareaRef.current?.focus();
                    }}
                    className="text-left text-xs p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-muted-foreground hover:text-foreground"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "flex gap-3",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[75%] rounded-2xl px-4 py-3 text-sm",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted text-foreground rounded-bl-md"
                )}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm prose-invert max-w-none">
                    <Streamdown>{msg.content}</Streamdown>
                  </div>
                ) : (
                  <p>{msg.content}</p>
                )}
                {msg.role === "assistant" && msg.riskLevel && (
                  <div className="mt-2 flex items-center gap-2">
                    <RiskBadge level={msg.riskLevel} />
                    {ttsEnabled && (
                      <button
                        onClick={() => speakText(msg.content)}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="Riascolta"
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center shrink-0 mt-1">
                  <User className="h-4 w-4 text-accent-foreground" />
                </div>
              )}
            </div>
          ))}

          {sendMutation.isPending && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="mt-3 flex items-end gap-2">
          {/* Mic Button */}
          <Button
            variant={isListening ? "default" : "outline"}
            size="icon"
            onClick={isListening ? stopListening : startListening}
            className={cn(
              "shrink-0 h-11 w-11 rounded-full transition-all",
              isListening && "bg-red-500 hover:bg-red-600 animate-pulse"
            )}
            title={isListening ? "Ferma registrazione" : "Parla con ADAM"}
          >
            {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </Button>

          {/* Text Input */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isListening ? "Sto ascoltando..." : "Scrivi o parla con ADAM..."}
              rows={1}
              className="w-full resize-none rounded-xl border border-border bg-card px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              style={{ minHeight: "44px", maxHeight: "120px" }}
            />
          </div>

          {/* Send Button */}
          <Button
            onClick={handleSend}
            disabled={!inputText.trim() || sendMutation.isPending}
            size="icon"
            className="shrink-0 h-11 w-11 rounded-full"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </Button>
        </div>

        {/* Voice Status */}
        {(isListening || isSpeaking) && (
          <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            {isListening && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                Registrazione in corso... parla ora
              </span>
            )}
            {isSpeaking && (
              <span className="flex items-center gap-1">
                <Volume2 className="h-3 w-3 text-primary animate-pulse" />
                ADAM sta parlando...
                <button onClick={stopSpeaking} className="underline hover:text-primary">
                  Ferma
                </button>
              </span>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
