import { useEffect, useState } from 'react'
import explanations from './explanations.json'

export function useExplanations() {
  const [exp, setExp] = useState(explanations)

  // Get explanation for a term (checks acronyms, buttons, labels, fields, settings in order)
  const get = (key) => {
    return exp.acronyms[key] || exp.buttons[key] || exp.labels[key] || exp.fields[key] || exp.settings[key] || ''
  }

  return { exp, get }
}
