import { Artwork } from "../../../shared/ui/Artwork";

export function PlaylistArtwork({ src, size, className = "" }: { src: string; size: number; className?: string }) {
  if (/^(data:|blob:)/i.test(src)) {
    return <span className={`artwork ${className}`}><img src={src} alt="" /></span>;
  }
  return <Artwork src={src} size={size} className={className} />;
}
