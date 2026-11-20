export function Whale({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 13c0 4 3.5 6 8 6 5 0 9-3 9-8 0-1.5-.5-2.5-1-3l2-3h-4c-1 1-1.5 2-1.5 3.5" /><path d="M3 13c2-1 4-1 6 0" /><circle cx="8" cy="15" r=".5" fill="currentColor" />
    </svg>
  );
}
