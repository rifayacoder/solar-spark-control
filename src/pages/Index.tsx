import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sun, Power, Zap, Droplets, Thermometer, MapPin, History, Wifi, WifiOff, CloudRain, RefreshCw } from "lucide-react";

type LogEntry = {
  time: string;
  action: string;
  status: "success" | "error" | "info";
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
  const portRef = useRef<any>(null);
  const writerRef = useRef<any>(null);
  const readerRef = useRef<any>(null);

  const addLog = useCallback((action: string, status: LogEntry["status"] = "info") => {
    const time = new Date().toLocaleTimeString();
    setHistory((prev) => [{ time, action, status }, ...prev].slice(0, 50));
  }, []);

  const addSerialLine = useCallback((line: string) => {
    setSerialOutput((prev) => [...prev, line].slice(-100));
  }, []);

  // Parse incoming serial data from ESP32
  const parseSerialData = useCallback((line: string) => {
    addSerialLine(line);
    if (line.startsWith("TEMP:")) {
      const val = parseFloat(line.replace("TEMP:", ""));
      if (!isNaN(val)) setTemperature(val);
    } else if (line.startsWith("RAIN:")) {
      setRainDetected(line.includes("1") || line.toLowerCase().includes("yes"));
    } else if (line.startsWith("STATUS:")) {
      addLog(line, "info");
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
      // port closed
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
    const next = !motorOn;
    setMotorOn(next);
    sendCommand(next ? "MOTOR_ON" : "MOTOR_OFF");
  };

  const toggleAutoMode = () => {
    const next = !autoMode;
    setAutoMode(next);
    sendCommand(next ? "AUTO_ON" : "AUTO_OFF");
  };

  const sendLocation = () => {
    if (location.lat && location.lng) {
      sendCommand(`LOC:${location.lat},${location.lng}`);
      addLog(`Location set: ${location.lat}, ${location.lng}`, "success");
    }
  };

  // Simulated weather polling (replace with real API if needed)
  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(() => {
      sendCommand("GET_TEMP");
      sendCommand("GET_RAIN");
    }, 10000);
    return () => clearInterval(interval);
  }, [connected]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4">
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
          <Badge
            variant={connected ? "default" : "secondary"}
            className={connected ? "bg-accent text-accent-foreground" : ""}
          >
            {connected ? <Wifi className="mr-1 h-3 w-3" /> : <WifiOff className="mr-1 h-3 w-3" />}
            {connected ? "Connected" : "Disconnected"}
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-6">
        {/* Connection */}
        <div className="mb-6 flex gap-3">
          {!connected ? (
            <Button onClick={connectESP32} className="bg-primary text-primary-foreground hover:bg-solar-dark">
              <Zap className="mr-2 h-4 w-4" /> Connect ESP32
            </Button>
          ) : (
            <Button onClick={disconnectESP32} variant="destructive">
              <Power className="mr-2 h-4 w-4" /> Disconnect
            </Button>
          )}
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Motor Control */}
          <Card className={motorOn ? "animate-pulse-glow border-primary" : ""}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Power className="h-5 w-5 text-primary" /> Motor Control
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Power</span>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${motorOn ? "text-accent" : "text-muted-foreground"}`}>
                    {motorOn ? "ON" : "OFF"}
                  </span>
                  <Switch checked={motorOn} onCheckedChange={toggleMotor} disabled={!connected} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Auto Mode</span>
                <div className="flex items-center gap-2">
                  <RefreshCw className={`h-4 w-4 ${autoMode ? "animate-spin-slow text-primary" : "text-muted-foreground"}`} />
                  <Switch checked={autoMode} onCheckedChange={toggleAutoMode} disabled={!connected} />
                </div>
              </div>
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
                <span className="text-4xl font-bold text-foreground">
                  {temperature !== null ? `${temperature}°C` : "--"}
                </span>
                <p className="mt-1 text-xs text-muted-foreground">Panel Surface Temperature</p>
              </div>
            </CardContent>
          </Card>

          {/* Rain Alert */}
          <Card className={rainDetected ? "border-rain" : ""}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CloudRain className={`h-5 w-5 ${rainDetected ? "text-rain" : "text-muted-foreground"}`} />
                Rain Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                {rainDetected ? (
                  <>
                    <Droplets className="mx-auto h-10 w-10 text-rain" />
                    <p className="mt-2 text-sm font-semibold text-rain">Rain Detected!</p>
                    <p className="text-xs text-muted-foreground">Cleaning paused automatically</p>
                  </>
                ) : (
                  <>
                    <Sun className="mx-auto h-10 w-10 text-solar-glow" />
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
              <div className="h-48 overflow-y-auto rounded-lg bg-foreground/5 p-3 font-mono text-xs">
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
