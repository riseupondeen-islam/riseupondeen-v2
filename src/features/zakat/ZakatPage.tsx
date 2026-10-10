import { useState, type FormEvent } from 'react';
import { FeaturePageHead } from '../tools/FeaturePageHead';
import {
  EMPTY_ZAKAT_INPUTS,
  NISAB_BASIS_LABELS,
  ZAKAT_CURRENCIES,
  calculateZakat,
  formatZakat,
  type NisabBasis,
  type ZakatField,
  type ZakatInputs,
} from './zakatCalculator';

/* Inputs stay uncontrolled (no value attribute is written to the DOM, exactly like the original
   markup); React's onChange fires on every input event and the results are derived from state. */
const AMOUNT_FIELDS: ReadonlyArray<readonly [ZakatField, string, string, string]> = [
  ['cash', 'rudZakatCash', 'Cash & bank savings', '0'],
  ['gold', 'rudZakatGold', 'Gold · zakatable value', '0'],
  ['silver', 'rudZakatSilver', 'Silver · zakatable value', '0'],
  ['investments', 'rudZakatInvestments', 'Investments · zakatable portion', '0'],
  ['business', 'rudZakatBusiness', 'Business / zakatable assets', '0'],
  ['liabilities', 'rudZakatLiabilities', 'Eligible deductible liabilities', '0'],
];

function AmountInput({ id, placeholder, onValue }: { id: string; placeholder: string; onValue: (v: string) => void }) {
  const update = (e: FormEvent<HTMLInputElement>) => onValue(e.currentTarget.value);
  return (
    <input
      id={id}
      className="rud-zakat-input"
      type="number"
      min="0"
      step="0.01"
      inputMode="decimal"
      placeholder={placeholder}
      onChange={update}
    />
  );
}

export function ZakatPage() {
  const [currency, setCurrency] = useState<string>(ZAKAT_CURRENCIES[0]);
  const [basis, setBasis] = useState<NisabBasis>('gold');
  const [inputs, setInputs] = useState<ZakatInputs>(EMPTY_ZAKAT_INPUTS);
  const setField = (field: ZakatField) => (value: string) =>
    setInputs((prev) => (prev[field] === value ? prev : { ...prev, [field]: value }));

  const { total, nisab, due, status } = calculateZakat(inputs);
  const fmt = (v: number) => formatZakat(v, currency);

  return (
    <section className="rud-feature-page rud-zakat-page">
      <FeaturePageHead kicker="Zakat" title="Zakat" copy="Calculate your estimated Zakat clearly and transparently." />
      <section className="rud-zakat-calculator rud-tool-surface">
        <div className="rud-zakat-intro">
          <span className="eyebrow">ZAKAT CALCULATOR</span>
          <h2>Estimate your Zakat.</h2>
          <p>Enter only the zakatable value for each category according to the ruling you follow.</p>
        </div>
        <div className="rud-zakat-grid">
          <label>
            Currency
            <select
              id="rudZakatCurrency"
              className="rud-zakat-input"
              onChange={(e) => setCurrency(e.currentTarget.value)}
            >
              {ZAKAT_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {AMOUNT_FIELDS.map(([field, id, label, placeholder]) => (
            <label key={id}>
              {label}
              <AmountInput id={id} placeholder={placeholder} onValue={setField(field)} />
            </label>
          ))}
          <label>
            Nisab basis
            <select
              id="rudZakatBasis"
              className="rud-zakat-input"
              onChange={(e) => setBasis(e.currentTarget.value as NisabBasis)}
            >
              <option value="gold">{NISAB_BASIS_LABELS.gold}</option>
              <option value="silver">{NISAB_BASIS_LABELS.silver}</option>
            </select>
          </label>
          <label>
            Current value of selected Nisab
            <AmountInput id="rudZakatNisab" placeholder="Enter current local value" onValue={setField('nisab')} />
          </label>
        </div>
        <div className="rud-zakat-results">
          <div>
            <span>Total Zakatable Amount</span>
            <strong id="rudZakatTotal">{fmt(total)}</strong>
          </div>
          <div>
            <span>Nisab status / basis</span>
            <strong id="rudZakatStatus">{status}</strong>
            <small id="rudZakatBasisText">{`${NISAB_BASIS_LABELS[basis]} · current threshold entered: ${nisab ? fmt(nisab) : '—'}`}</small>
          </div>
          <div className="due">
            <span>Estimated Zakat Due</span>
            <strong id="rudZakatDue">{fmt(due)}</strong>
            <small>2.5% applies when the net entered amount reaches the Nisab value you provide.</small>
          </div>
        </div>
        <p className="rud-zakat-disclaimer">
          This estimates monetary Zakat at 2.5% after the entered Nisab is reached. Jewellery, investments, business
          assets and liabilities can differ by circumstance and scholarly method, so enter only amounts you consider
          zakatable.
        </p>
      </section>
      <section className="rud-zakat-learn">
        <article className="rud-zakat-note">
          <span>01</span>
          <h3>What is Zakat?</h3>
          <p>Zakat is obligatory on qualifying wealth.</p>
          <small>Qur'an 2:43</small>
        </article>
        <article className="rud-zakat-note">
          <span>02</span>
          <h3>Who should pay?</h3>
          <p>Qualifying wealth must reach Nisab and meet the lunar-year condition.</p>
          <small>Sunan Abi Dawud 1573</small>
        </article>
        <article className="rud-zakat-note">
          <span>03</span>
          <h3>Nisab</h3>
          <p>Gold: 20 dinars. Silver: 200 dirhams. Enter the current local value of the basis you follow.</p>
          <small>Sunan Abi Dawud 1573 · Sahih al-Bukhari 1447</small>
        </article>
        <article className="rud-zakat-note">
          <span>04</span>
          <h3>Who can receive Zakat?</h3>
          <p>The Qur'an names eight eligible categories, including the poor and the needy.</p>
          <small>Qur'an 9:60</small>
        </article>
      </section>
    </section>
  );
}
