import { checkEmail } from '~/utils/email'

/**
 * Email input state for the auth forms: inline message, "Did you mean…?" suggestion,
 * and a validate() that focuses the field when it fails.
 */
export function useEmailField() {
  const email = ref('')
  const emailError = ref('')
  const emailSuggestion = ref('')
  const emailInput = ref<HTMLInputElement | null>(null)

  function clear() {
    emailError.value = ''
    emailSuggestion.value = ''
  }

  /** Soft check on blur: show the message / suggestion but don't steal focus. */
  function onBlur() {
    clear()
    if (!email.value.trim()) return
    const result = checkEmail(email.value)
    if (!result.ok) emailError.value = result.message ?? ''
    else if (result.suggestion) emailSuggestion.value = result.suggestion
  }

  /** Hard check on submit. Returns true when the address can be sent. */
  function validate(): boolean {
    clear()
    const result = checkEmail(email.value)
    if (!result.ok) {
      emailError.value = result.message ?? ''
      emailInput.value?.focus()
      return false
    }
    if (result.suggestion) emailSuggestion.value = result.suggestion
    email.value = email.value.trim()
    return true
  }

  function applySuggestion() {
    if (!emailSuggestion.value) return
    email.value = emailSuggestion.value
    clear()
    emailInput.value?.focus()
  }

  return { email, emailError, emailSuggestion, emailInput, onBlur, validate, applySuggestion, clear }
}
