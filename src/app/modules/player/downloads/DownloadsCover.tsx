
export function DownloadsCover({ className = "" }: { className?: string }) {
  return <svg aria-hidden className={`downloads-cover ${className}`} focusable="false" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="#292929" />
    <g transform="translate(22.4 22.4) scale(2.3)" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15V3" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
    </g>
  </svg>;
}
