import { Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import Auth from "./pages/Auth";
import Setup from "./pages/Setup";
import Dashboard from "./pages/Dashboard";
import Meeting from "./pages/Meeting";
import Protected from "./components/Protected";

export default function App() {
  return <Routes>
    <Route path="/" element={<Home/>}/>
    <Route path="/auth" element={<Auth/>}/>
    <Route path="/setup" element={<Setup/>}/>
    <Route path="/dashboard" element={<Protected><Dashboard/></Protected>}/>
    <Route path="/meeting/:roomName" element={<Protected><Meeting/></Protected>}/>
    <Route path="*" element={<Home/>}/>
  </Routes>;
}