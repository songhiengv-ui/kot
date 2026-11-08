// Unsaved quick-entry text survives closing the sheet by accident.
// Memory only — never written to browser storage; a reload or sign-out clears it.
let draft = ''
export const getDraft = () => draft
export const setDraft = (s: string) => { draft = s }
export const clearDraft = () => { draft = '' }
