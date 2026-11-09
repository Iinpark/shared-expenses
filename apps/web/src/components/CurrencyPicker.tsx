import { CURRENCIES, currencyName, currencySymbol, must, QUICK_CURRENCIES, type CurrencyCode } from '@se/shared';

/** Валюта: три частые сегментами и «Другая» со списком (M09). */
export function CurrencyPicker({ value, onChange }: { value: CurrencyCode; onChange: (c: CurrencyCode) => void }) {
  const isQuick = QUICK_CURRENCIES.includes(value);
  const others = CURRENCIES.filter((c) => !QUICK_CURRENCIES.includes(c));
  return (
    <div className="field">
      <span id="cur" className="field__label">
        Валюта
      </span>
      <div role="radiogroup" aria-labelledby="cur" className="segments">
        {QUICK_CURRENCIES.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={currencyName(c)} onClick={() => {
              onChange(c);
            }}
          >
            {currencySymbol(c)}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={!isQuick} onClick={() => {
            if (isQuick) onChange(must(others[0], 'другая валюта'));
          }}
        >
          Другая
        </button>
      </div>
      {!isQuick && (
        <select className="select" aria-label="Другая валюта" value={value} onChange={(e) => {
            onChange(e.target.value as CurrencyCode);
          }}
        >
          {others.map((c) => (
            <option key={c} value={c}>
              {capitalize(currencyName(c))}, {currencySymbol(c)}
            </option>
          ))}
        </select>
      )}
      <p className="hint-sm" style={{ marginTop: 2 }}>
        Одна валюта на группу. После первого расхода её не поменять.
      </p>
    </div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «Рубль, ₽» как в макетах. */
export function currencyLabel(code: string) {
  try {
    const c = code as CurrencyCode;
    return `${capitalize(currencyName(c).split(' ').at(-1) ?? c)}, ${currencySymbol(c)}`;
  } catch {
    return code;
  }
}
