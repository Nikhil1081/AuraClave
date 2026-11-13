import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { Room, RoomEvent } from "livekit-client";
import { AudioSession, registerGlobals } from "@livekit/react-native";

registerGlobals();

const API_URL = "https://auraclave-api.onrender.com";
const TOKEN_KEY = "auraclave_mobile_token";
const USER_KEY = "auraclave_mobile_user";

type User = { id: string; email: string; user_metadata?: { full_name?: string } };
type Screen = "auth" | "dashboard" | "meeting";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

async function apiRequest(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function AuthScreen({ onSignedIn }: { onSignedIn: (token: string, user: User) => void }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || !password) {
      Alert.alert("Missing details", "Enter your email and password.");
      return;
    }
    if (isSignUp && !name.trim()) {
      Alert.alert("Missing name", "Enter your display name.");
      return;
    }
    setBusy(true);
    try {
      const data = await apiRequest(`/api/auth/${isSignUp ? "signup" : "login"}`, {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password, ...(isSignUp ? { name: name.trim() } : {}) })
      });
      onSignedIn(data.token, data.user);
    } catch (error) {
      Alert.alert("Unable to continue", getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.authContainer} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>AuraClave</Text>
        <Text style={styles.tagline}>Meet, collaborate, and connect.</Text>
        <View style={styles.card}>
          <Text style={styles.heading}>{isSignUp ? "Create your account" : "Welcome back"}</Text>
          {isSignUp && <TextInput autoCapitalize="words" placeholder="Your name" placeholderTextColor="#8290a8" style={styles.input} value={name} onChangeText={setName} />}
          <TextInput autoCapitalize="none" keyboardType="email-address" placeholder="Email address" placeholderTextColor="#8290a8" style={styles.input} value={email} onChangeText={setEmail} />
          <TextInput secureTextEntry placeholder="Password" placeholderTextColor="#8290a8" style={styles.input} value={password} onChangeText={setPassword} />
          <Pressable style={styles.primaryButton} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{isSignUp ? "Sign up" : "Log in"}</Text>}
          </Pressable>
          <Pressable onPress={() => setIsSignUp((value) => !value)} style={styles.linkButton}>
            <Text style={styles.linkText}>{isSignUp ? "Already have an account? Log in" : "New to AuraClave? Sign up"}</Text>
          </Pressable>
        </View>
      </ScrollView>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

function Dashboard({ user, token, onJoin, onSignOut }: { user: User; token: string; onJoin: (room: string) => void; onSignOut: () => void }) {
  const [room, setRoom] = useState("");
  const name = user.user_metadata?.full_name || user.email.split("@")[0];
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.dashboard}>
        <View style={styles.header}>
          <View>
            <Text style={styles.logoSmall}>AuraClave</Text>
            <Text style={styles.muted}>Hello, {name}</Text>
          </View>
          <Pressable onPress={onSignOut}><Text style={styles.linkText}>Sign out</Text></Pressable>
        </View>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Ready to connect?</Text>
          <Text style={styles.muted}>Join a meeting using the room code shared by your host.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>Join a meeting</Text>
          <TextInput autoCapitalize="none" placeholder="Enter room code" placeholderTextColor="#8290a8" style={styles.input} value={room} onChangeText={setRoom} />
          <Pressable style={styles.primaryButton} onPress={() => room.trim() && onJoin(room.trim())}>
            <Text style={styles.primaryText}>Join meeting</Text>
          </Pressable>
        </View>
        <Text style={styles.smallPrint}>Your web AuraClave app remains unchanged. This Android app uses the same account and LiveKit service.</Text>
      </View>
    </SafeAreaView>
  );
}

function Meeting({ roomName, authToken, user, onLeave }: { roomName: string; authToken: string; user: User; onLeave: () => void }) {
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<string[]>([]);
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const updateParticipants = () => {
      if (!active) return;
      setParticipants([room.localParticipant.name || user.email, ...Array.from(room.remoteParticipants.values()).map((participant) => participant.name || participant.identity)]);
    };
    room.on(RoomEvent.ParticipantConnected, updateParticipants);
    room.on(RoomEvent.ParticipantDisconnected, updateParticipants);
    AudioSession.startAudioSession().then(() => apiRequest("/api/livekit/token", {
      method: "POST",
      body: JSON.stringify({ roomName })
    }, authToken)).then((data) => room.connect(data.url, data.token)).then(() => {
      if (!active) return;
      setConnected(true);
      updateParticipants();
    }).catch((connectError) => setError(getErrorMessage(connectError)));
    return () => {
      active = false;
      room.removeAllListeners();
      room.disconnect();
      AudioSession.stopAudioSession();
    };
  }, [room, roomName, authToken, user.email, user.user_metadata?.full_name]);

  async function toggleMic() {
    const next = !micOn;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  }

  async function toggleCamera() {
    const next = !cameraOn;
    await room.localParticipant.setCameraEnabled(next);
    setCameraOn(next);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.meeting}>
        <View style={styles.header}>
          <View><Text style={styles.logoSmall}>AuraClave</Text><Text style={styles.muted}>{roomName}</Text></View>
          <Pressable onPress={onLeave}><Text style={styles.leaveText}>Leave</Text></Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : !connected ? <ActivityIndicator color="#7c5cff" size="large" /> : (
          <>
            <Text style={styles.connected}>{participants.length} participant{participants.length === 1 ? "" : "s"}</Text>
            <View style={styles.participantGrid}>
              {participants.map((participant) => <View style={styles.participantTile} key={participant}><Text style={styles.avatar}>{participant.charAt(0).toUpperCase()}</Text><Text style={styles.participantName}>{participant}</Text></View>)}
            </View>
            <View style={styles.controls}>
              <Pressable style={[styles.control, micOn && styles.controlActive]} onPress={toggleMic}><Text style={styles.controlText}>{micOn ? "Mute" : "Mic"}</Text></Pressable>
              <Pressable style={[styles.control, cameraOn && styles.controlActive]} onPress={toggleCamera}><Text style={styles.controlText}>{cameraOn ? "Camera off" : "Camera"}</Text></Pressable>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("auth");
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [room, setRoom] = useState("");

  useEffect(() => {
    Promise.all([SecureStore.getItemAsync(TOKEN_KEY), SecureStore.getItemAsync(USER_KEY)]).then(async ([savedToken, savedUser]) => {
      if (!savedToken || !savedUser) return;
      try {
        const data = await apiRequest("/api/auth/me", {}, savedToken);
        setToken(savedToken);
        setUser(data.user);
        setScreen("dashboard");
      } catch {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        await SecureStore.deleteItemAsync(USER_KEY);
      }
    });
  }, []);

  async function signedIn(nextToken: string, nextUser: User) {
    await SecureStore.setItemAsync(TOKEN_KEY, nextToken);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
    setScreen("dashboard");
  }

  async function signOut() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    setToken("");
    setUser(null);
    setScreen("auth");
  }

  if (screen === "auth" || !user) return <AuthScreen onSignedIn={signedIn} />;
  if (screen === "meeting") return <Meeting roomName={room} authToken={token} user={user} onLeave={() => setScreen("dashboard")} />;
  return <Dashboard user={user} token={token} onJoin={(nextRoom) => { setRoom(nextRoom); setScreen("meeting"); }} onSignOut={signOut} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b1020" },
  authContainer: { flexGrow: 1, justifyContent: "center", padding: 24 },
  dashboard: { flex: 1, padding: 24 },
  meeting: { flex: 1, padding: 20 },
  logo: { color: "#fff", fontSize: 40, fontWeight: "800", letterSpacing: -1 },
  logoSmall: { color: "#fff", fontSize: 22, fontWeight: "800" },
  tagline: { color: "#9da8c0", fontSize: 16, marginTop: 8, marginBottom: 28 },
  card: { backgroundColor: "#151d32", borderRadius: 22, padding: 20, borderWidth: 1, borderColor: "#283450" },
  heading: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 18 },
  input: { backgroundColor: "#0e1528", color: "#fff", borderRadius: 12, padding: 15, marginBottom: 12, borderWidth: 1, borderColor: "#2b3857", fontSize: 16 },
  primaryButton: { backgroundColor: "#7c5cff", borderRadius: 12, alignItems: "center", padding: 16, marginTop: 4 },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  linkButton: { alignItems: "center", marginTop: 18 },
  linkText: { color: "#a996ff", fontWeight: "600" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 30 },
  muted: { color: "#9da8c0", marginTop: 4 },
  hero: { marginVertical: 20 },
  heroTitle: { color: "#fff", fontSize: 30, fontWeight: "800", marginBottom: 8 },
  smallPrint: { color: "#71809b", textAlign: "center", marginTop: 26, lineHeight: 20 },
  leaveText: { color: "#ff7180", fontWeight: "700" },
  error: { color: "#ff9ba5", backgroundColor: "#351b2a", padding: 14, borderRadius: 12, marginBottom: 20 },
  connected: { color: "#9da8c0", marginBottom: 16 },
  participantGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  participantTile: { backgroundColor: "#151d32", borderRadius: 16, minHeight: 130, width: "48%", alignItems: "center", justifyContent: "center", padding: 12 },
  avatar: { backgroundColor: "#7c5cff", color: "#fff", borderRadius: 30, width: 52, height: 52, textAlign: "center", paddingTop: 13, fontSize: 22, fontWeight: "700" },
  participantName: { color: "#fff", marginTop: 10, textAlign: "center" },
  controls: { flexDirection: "row", justifyContent: "center", gap: 12, marginTop: "auto", paddingVertical: 20 },
  control: { backgroundColor: "#26324c", borderRadius: 25, paddingVertical: 14, paddingHorizontal: 22 },
  controlActive: { backgroundColor: "#7c5cff" },
  controlText: { color: "#fff", fontWeight: "700" }
});
