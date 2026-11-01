import { Video } from "lucide-react";
export default function Brand({ small = false }: { small?: boolean }) {
  return <div className="brand"><span className="brand-mark"><Video size={small ? 17 : 20} /></span><span>Nex<span className="brand-accent">Meet</span></span></div>;
}