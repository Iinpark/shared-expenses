import { initial } from '@se/shared';

export function Avatar({ name, size }: { name: string; size?: 'lg' }) {
  return <span className={`avatar${size === 'lg' ? ' avatar--lg' : ''}`}>{initial(name)}</span>;
}
