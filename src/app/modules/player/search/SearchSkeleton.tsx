const widths = [68, 55, 72, 48, 62];

export function SearchSkeleton({ label = "Searching" }: { label?: string }) {
  return <div className="search-skeleton" role="status" aria-label={label}>
    {widths.map((width) => <div key={width}><span /><span><i style={{ width: `${width}%` }} /><i style={{ width: `${Math.round(width * 0.6)}%` }} /></span></div>)}
  </div>;
}
