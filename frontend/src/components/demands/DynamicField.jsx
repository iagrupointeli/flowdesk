import { Controller } from 'react-hook-form'

/**
 * Componente burro: renderiza um campo dinâmico do formulário de criação.
 *
 * Props:
 *   field   — metadados do campo ({ id, label, field_type, required, options })
 *   register — react-hook-form register (para inputs simples)
 *   control  — react-hook-form control (necessário para CPF com Controller)
 *   error    — FieldError do formState.errors.payload[field.id]
 *
 * Nenhuma lógica de negócio aqui — apenas apresentação.
 * Validação e transformação vivem em buildDemandSchema.js.
 */
export default function DynamicField({ field, register, control, error }) {
  const baseClass = [
    'block w-full rounded-lg border px-3 py-2 text-sm text-gray-900',
    'transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-400',
    error
      ? 'border-red-400 bg-red-50 focus:ring-red-400'
      : 'border-gray-300 bg-white hover:border-gray-400',
  ].join(' ')

  const label = (
    <label
      htmlFor={`field-${field.id}`}
      className="mb-1 block text-sm font-medium text-gray-700"
    >
      {field.label}
      {field.required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  )

  const errorMsg = error && (
    <p className="mt-1 text-xs text-red-500">{error.message}</p>
  )

  // ── text ──────────────────────────────────────────────────────────────────
  if (field.field_type === 'text') {
    return (
      <div>
        {label}
        <input
          id={`field-${field.id}`}
          type="text"
          className={baseClass}
          placeholder={field.label}
          {...register(`payload.${field.id}`)}
        />
        {errorMsg}
      </div>
    )
  }

  // ── textarea ──────────────────────────────────────────────────────────────
  if (field.field_type === 'textarea') {
    return (
      <div>
        {label}
        <textarea
          id={`field-${field.id}`}
          rows={3}
          className={`${baseClass} resize-y`}
          placeholder={field.label}
          {...register(`payload.${field.id}`)}
        />
        {errorMsg}
      </div>
    )
  }

  // ── number ────────────────────────────────────────────────────────────────
  if (field.field_type === 'number') {
    return (
      <div>
        {label}
        <input
          id={`field-${field.id}`}
          type="number"
          step="any"
          className={baseClass}
          placeholder="0"
          {...register(`payload.${field.id}`)}
        />
        {errorMsg}
      </div>
    )
  }

  // ── date ──────────────────────────────────────────────────────────────────
  if (field.field_type === 'date') {
    return (
      <div>
        {label}
        <input
          id={`field-${field.id}`}
          type="date"
          className={baseClass}
          {...register(`payload.${field.id}`)}
        />
        {errorMsg}
      </div>
    )
  }

  // ── select ────────────────────────────────────────────────────────────────
  if (field.field_type === 'select') {
    const options = field.options ?? []
    return (
      <div>
        {label}
        <select
          id={`field-${field.id}`}
          className={baseClass}
          {...register(`payload.${field.id}`)}
        >
          <option value="">Selecione…</option>
          {options.map(opt => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
        {errorMsg}
      </div>
    )
  }

  // ── cpf (Controller + máscara) ────────────────────────────────────────────
  if (field.field_type === 'cpf') {
    return (
      <Controller
        control={control}
        name={`payload.${field.id}`}
        defaultValue=""
        render={({ field: ctrl }) => (
          <div>
            {label}
            <input
              id={`field-${field.id}`}
              type="text"
              inputMode="numeric"
              placeholder="000.000.000-00"
              maxLength={14}
              className={baseClass}
              value={ctrl.value ?? ''}
              onChange={e => ctrl.onChange(maskCpf(e.target.value))}
              onBlur={ctrl.onBlur}
            />
            {errorMsg}
          </div>
        )}
      />
    )
  }

  // ── fallback (unknown field_type) ──────────────────────────────────────────
  return (
    <div>
      {label}
      <input
        id={`field-${field.id}`}
        type="text"
        className={baseClass}
        {...register(`payload.${field.id}`)}
      />
      {errorMsg}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Aplica a máscara CPF: 000.000.000-00
 * Remove não-dígitos, limita a 11, formata progressivamente.
 */
function maskCpf(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}
