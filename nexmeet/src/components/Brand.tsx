import { Video } from "lucide-react";
export default function Brand({ small = false }: { small?: boolean }) {
  return <div className="brand"><span className="brand-mark"><Video size={small ? 17 : 20} /></span><span>Aura<span className="brand-accent">Clave</span></span></div>;
}
