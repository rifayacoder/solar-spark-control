import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sun, Power, Zap, Droplets, Thermometer, MapPin, History, Wifi, WifiOff, CloudRain, RefreshCw, Settings, Gauge, Timer, RotateCcw, Ruler } from "lucide-react";

type LogEntry = {
  time: string;
  action: string;
  status: "success" | "error" | "info";
};

type LimitSettings = {
  railDistance: number;      // cm
  timerDuration: number;     // seconds
  speed: number;             // PWM 0-255
  cleaningCycles: number;    // number of passes
};

const Index = () => {
  const [connected, setConnected] = useState(false);
  const [motorOn, setMotorOn] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [temperature, setTemperature] = useState<number | null>(null);
  const [rainDetected, setRainDetected] = useState(false);
  const [location, setLocation] = useState({ lat: "", lng: "" });
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [serialOutput, setSerialOutput] = useState<string[]>([]);
  const [limits, setLimits] = useState<LimitSettings>({
    railDistance: 100,
    timerDuration: 60,
    speed: 200,
    cleaningCycles: 3,
  });
  const [limitsApplied, setLimitsApplied] = useState(false);
  const portRef = useRef<any>(null);
  const writerRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const serialConsoleRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((action: string, status: LogEntry["status"] = "info") => {
    const time = new Date().toLocaleTimeString();
    setHistory((prev) => [{ time, action, status }, ...prev].slice(0, 50));
  }, []);

  const addSerialLine = useCallback((line: string) => {
    setSerialOutput((prev) => [...prev, line].slice(-100));
  }, []);

  // Auto-scroll serial console
  useEffect(() => {
    if (serialConsoleRef.current) {
      serialConsoleRef.current.scrollTop = serialConsoleRef.current.scrollHeight;
    }
  }, [serialOutput]);

  // Parse incoming serial data from ESP32
  const parseSerialData = useCallback((line: string) => {
    addSerialLine(line);
    if (line.startsWith("TEMP:")) {
      const val = parseFloat(line.replace("TEMP:", "").trim());
      if (!isNaN(val)) {
        setTemperature(val);
        addLog(`Temperature: ${val}°C`, "info");
      }
    } else if (line.startsWith("RAIN:")) {
      const isRaining = line.includes("1") || line.toLowerCase().includes("yes");
      setRainDetected(isRaining);
      addLog(`Rain: ${isRaining ? "Detected" : "Clear"}`, isRaining ? "error" : "info");
    } else if (line.startsWith("MOTOR:")) {
      const state = line.includes("ON") || line.includes("1");
      setMotorOn(state);
      addLog(`Motor ${state ? "started" : "stopped"}`, "info");
    } else if (line.startsWith("STATUS:")) {
      addLog(line.replace("STATUS:", "").trim(), "info");
    } else if (line.startsWith("ERROR:")) {
      addLog(line.replace("ERROR:", "").trim(), "error");
    }
  }, [addLog, addSerialLine]);

  // Read loop for serial
  const readLoop = useCallback(async (reader: any) => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        lines.forEach((l: string) => {
          const trimmed = l.trim();
          if (trimmed) parseSerialData(trimmed);
        });
      }
    } catch {
      // port closed or error
    }
  }, [parseSerialData]);

  const connectESP32 = async () => {
    try {
      if (!("serial" in navigator)) {
        addLog("Web Serial API not supported. Use Chrome/Edge.", "error");
        return;
      }
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 115200 });
      portRef.current = port;
      writerRef.current = port.writable.getWriter();
      readerRef.current = port.readable.getReader();
      setConnected(true);
      addLog("ESP32 Connected", "success");
      readLoop(readerRef.current);
      // Request initial data
      setTimeout(() => {
        sendCommand("GET_TEMP");
        sendCommand("GET_RAIN");
        sendCommand("GET_STATUS");
      }, 1000);
    } catch {
      addLog("Connection failed", "error");
    }
  };

  const disconnectESP32 = async () => {
    try {
      readerRef.current?.cancel();
      writerRef.current?.releaseLock();
      await portRef.current?.close();
    } catch {}
    setConnected(false);
    setMotorOn(false);
    setAutoMode(false);
    setLimitsApplied(false);
    portRef.current = null;
    writerRef.current = null;
    readerRef.current = null;
    addLog("ESP32 Disconnected", "info");
  };

  const sendCommand = async (cmd: string) => {
    if (!writerRef.current) {
      addLog("Not connected", "error");
      return;
    }
    try {
      const encoder = new TextEncoder();
      await writerRef.current.write(encoder.encode(cmd + "\n"));
      addLog(`Sent: ${cmd}`, "success");
      addSerialLine(`> ${cmd}`);
    } catch {
      addLog(`Failed to send: ${cmd}`, "error");
    }
  };

  const toggleMotor = () => {
    if (!limitsApplied) {
      addLog("Set limits first before running motor!", "error");
      return;
    }
    const next = !motorOn;
    setMotorOn(next);
    sendCommand(next ? "MOTOR_ON" : "MOTOR_OFF");
  };

  const toggleAutoMode = () => {
    if (!limitsApplied) {
      addLog("Set limits first before enabling auto mode!", "error");
      return;
    }
    const next = !autoMode;
    setAutoMode(next);
    sendCommand(next ? "AUTO_ON" : "AUTO_OFF");
  };

  const applyLimits = () => {
    sendCommand(`SET_RAIL:${limits.railDistance}`);
    sendCommand(`SET_TIMER:${limits.timerDuration}`);
    sendCommand(`SET_SPEED:${limits.speed}`);
    sendCommand(`SET_CYCLES:${limits.cleaningCycles}`);
    setLimitsApplied(true);
    addLog(`Limits applied — Rail: ${limits.railDistance}cm, Timer: ${limits.timerDuration}s, Speed: ${limits.speed}, Cycles: ${limits.cleaningCycles}`, "success");
  };

  const sendLocation = () => {
    if (location.lat && location.lng) {
      sendCommand(`LOC:${location.lat},${location.lng}`);
      addLog(`Location set: ${location.lat}, ${location.lng}`, "success");
    }
  };

  // Poll sensor data when connected
  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(() => {
      sendCommand("GET_TEMP");
      sendCommand("GET_RAIN");
    }, 5000);
    return () => clearInterval(interval);
  }, [connected]);

  const getSpeedLabel = (val: number) => {
    if (val < 80) return "Slow";
    if (val < 170) return "Medium";
    return "Fast";
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary p-2">
              <Sun className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">SolarClean Pro</h1>
              <p className="text-xs text-muted-foreground">ESP32 Panel Cleaning System</p>
            </div>
          </div>
          <div className={`flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${connected ? "bg-accent/20 text-accent" : "bg-muted text-muted-foreground"}`}>
            {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {connected ? "Connected" : "Disconnected"}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-4">
        {/* Connection */}
        <div className="mb-4 flex gap-3">
          {!connected ? (
            <Button onClick={connectESP32} className="bg-primary text-primary-foreground">
              <Zap className="mr-2 h-4 w-4" /> Connect ESP32
            </Button>
          ) : (
            <Button onClick={disconnectESP32} variant="destructive">
              <Power className="mr-2 h-4 w-4" /> Disconnect
            </Button>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">

          {/* ===== LIMIT SETTINGS (must set before motor) ===== */}
          <Card className="md:col-span-2 lg:col-span-3 border-primary/30">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings className="h-5 w-5 text-primary" /> Limit Settings
                {limitsApplied && (
                  <span className="ml-2 rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent">Applied ✓</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {/* Rail Distance */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Ruler className="h-4 w-4 text-primary" /> Rail Distance
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={10}
                      max={500}
                      value={limits.railDistance}
                      onChange={(e) => setLimits((p) => ({ ...p, railDistance: Number(e.target.value) }))}
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">cm</span>
                  </div>
                  <p className="text-xs text-muted-foreground">How far the rail travels (10-500cm)</p>
                </div>

                {/* Timer Duration */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Timer className="h-4 w-4 text-primary" /> Timer Duration
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={10}
                      max={600}
                      value={limits.timerDuration}
                      onChange={(e) => setLimits((p) => ({ ...p, timerDuration: Number(e.target.value) }))}
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">sec</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Auto-stop after this time</p>
                </div>

                {/* Speed */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Gauge className="h-4 w-4 text-primary" /> Speed
                  </div>
                  <Slider
                    value={[limits.speed]}
                    onValueChange={(v) => setLimits((p) => ({ ...p, speed: v[0] }))}
                    min={50}
                    max={255}
                    step={5}
                    className="py-2"
                  />
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">PWM: {limits.speed}</span>
                    <span className="font-medium text-primary">{getSpeedLabel(limits.speed)}</span>
                  </div>
                </div>

                {/* Cleaning Cycles */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <RotateCcw className="h-4 w-4 text-primary" /> Cleaning Cycles
                  </div>
                  <Select
                    value={String(limits.cleaningCycles)}
                    onValueChange={(v) => setLimits((p) => ({ ...p, cleaningCycles: Number(v) }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                        <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "pass" : "passes"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Back-and-forth passes</p>
                </div>
              </div>

              <Button
                onClick={applyLimits}
                disabled={!connected}
                className="mt-4 w-full bg-primary text-primary-foreground"
              >
                {limitsApplied ? "Update Limits" : "Apply Limits"}
              </Button>
              {!limitsApplied && connected && (
                <p className="mt-2 text-center text-xs text-destructive font-medium">⚠ You must apply limits before running the motor</p>
              )}
            </CardContent>
          </Card>

          {/* Motor Control */}
          <Card className={motorOn ? "animate-pulse-glow border-primary" : ""}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Power className="h-5 w-5 text-primary" /> Rali Motor Control
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Power</span>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${motorOn ? "text-accent" : "text-muted-foreground"}`}>
                    {motorOn ? "ON" : "OFF"}
                  </span>
                  <Switch checked={motorOn} onCheckedChange={toggleMotor} disabled={!connected || !limitsApplied} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Auto Mode</span>
                <div className="flex items-center gap-2">
                  <RefreshCw className={`h-4 w-4 ${autoMode ? "animate-spin-slow text-primary" : "text-muted-foreground"}`} />
                  <Switch checked={autoMode} onCheckedChange={toggleAutoMode} disabled={!connected || !limitsApplied} />
                </div>
              </div>
              {limitsApplied && (
                <div className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground space-y-1">
                  <p>Rail: {limits.railDistance}cm | Speed: {getSpeedLabel(limits.speed)}</p>
                  <p>Timer: {limits.timerDuration}s | Cycles: {limits.cleaningCycles}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Temperature */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Thermometer className="h-5 w-5 text-primary" /> Temperature
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                <span className={`text-4xl font-bold ${temperature !== null ? (temperature > 50 ? "text-destructive" : "text-foreground") : "text-muted-foreground"}`}>
                  {temperature !== null ? `${temperature}°C` : "--"}
                </span>
                <p className="mt-1 text-xs text-muted-foreground">
                  {temperature === null
                    ? (connected ? "Waiting for sensor data..." : "Connect ESP32 to read")
                    : "Panel Surface Temperature"
                  }
                </p>
                {connected && temperature === null && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => sendCommand("GET_TEMP")}
                  >
                    Request Temperature
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Rain Alert */}
          <Card className={rainDetected ? "border-secondary" : ""}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CloudRain className={`h-5 w-5 ${rainDetected ? "text-secondary" : "text-muted-foreground"}`} />
                Rain Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                {rainDetected ? (
                  <>
                    <Droplets className="mx-auto h-10 w-10 text-secondary" />
                    <p className="mt-2 text-sm font-semibold text-secondary">Rain Detected!</p>
                    <p className="text-xs text-muted-foreground">Cleaning paused automatically</p>
                  </>
                ) : (
                  <>
                    <Sun className="mx-auto h-10 w-10 text-primary" />
                    <p className="mt-2 text-sm font-semibold text-foreground">Clear Sky</p>
                    <p className="text-xs text-muted-foreground">Safe to clean</p>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Location */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-5 w-5 text-primary" /> Panel Location
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Latitude"
                value={location.lat}
                onChange={(e) => setLocation((p) => ({ ...p, lat: e.target.value }))}
              />
              <Input
                placeholder="Longitude"
                value={location.lng}
                onChange={(e) => setLocation((p) => ({ ...p, lng: e.target.value }))}
              />
              <Button onClick={sendLocation} disabled={!connected} className="w-full bg-primary text-primary-foreground">
                Set Location
              </Button>
            </CardContent>
          </Card>

          {/* Serial Console */}
          <Card className="md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-5 w-5 text-primary" /> Serial Console
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div ref={serialConsoleRef} className="h-48 overflow-y-auto rounded-lg bg-foreground/5 p-3 font-mono text-xs">
                {serialOutput.length === 0 ? (
                  <p className="text-muted-foreground">Connect ESP32 to see serial output...</p>
                ) : (
                  serialOutput.map((line, i) => (
                    <div key={i} className={line.startsWith(">") ? "text-primary" : "text-foreground"}>
                      {line}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* History */}
          <Card className="md:col-span-2 lg:col-span-3">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-5 w-5 text-primary" /> Activity History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-60 space-y-2 overflow-y-auto">
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity yet</p>
                ) : (
                  history.map((entry, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div
                          className={`h-2 w-2 rounded-full ${
                            entry.status === "success"
                              ? "bg-accent"
                              : entry.status === "error"
                              ? "bg-destructive"
                              : "bg-primary"
                          }`}
                        />
                        <span className="text-sm text-foreground">{entry.action}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{entry.time}</span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Index;
