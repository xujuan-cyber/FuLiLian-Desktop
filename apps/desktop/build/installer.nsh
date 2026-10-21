; Fulilian - extra "command line mode" entry.
;
; The CLI runtime (%LOCALAPPDATA%\fulilian\bin\fulilian.cmd) is created by
; scripts/install.ps1 or by the desktop app's first-run bootstrap, neither of
; which runs at install time. cli-launcher.cmd therefore does the existence
; check and prints a readable hint instead of failing silently.

!macro customInstall
  CreateShortCut "$SMPROGRAMS\FuLiLian 命令行.lnk" "$INSTDIR\resources\cli-launcher.cmd" "" "$INSTDIR\resources\icon.ico" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\FuLiLian 命令行.lnk"
!macroend
