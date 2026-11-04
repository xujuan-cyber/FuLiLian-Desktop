import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'

import { renameTerminal } from './terminals'

interface RenameTerminalDialogProps {
  currentTitle: string
  onOpenChange: (open: boolean) => void
  open: boolean
  terminalId: string
}

/** Modal rename flow for a terminal tab, mirroring the chat sidebar's
 *  RenameSessionDialog. Renaming is a local synchronous store write, so there
 *  is no submitting state or success toast; an empty name would keep the old
 *  title (renameTerminal semantics), so save is disabled instead. */
export function RenameTerminalDialog({ currentTitle, onOpenChange, open, terminalId }: RenameTerminalDialogProps) {
  const { t } = useI18n()
  const [value, setValue] = useState(currentTitle)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue(currentTitle)
      // Select once the dialog has mounted so typing replaces the whole name.
      window.setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [currentTitle, open])

  const submit = () => {
    const next = value.trim()

    if (!next) {
      return
    }

    renameTerminal(terminalId, next)
    onOpenChange(false)
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.rightSidebar.terminalRenameTitle}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            } else if (event.key === 'Escape') {
              onOpenChange(false)
            }
          }}
          ref={inputRef}
          value={value}
        />
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {t.common.cancel}
          </Button>
          <Button disabled={!value.trim()} onClick={submit} type="button">
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
