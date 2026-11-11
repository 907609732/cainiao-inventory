; Additional launch entry for the same independent application and profile.
!macro customInstall
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}（网页版）.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--web" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend
!macro customUnInstall
  Delete "$SMPROGRAMS\${PRODUCT_NAME}（网页版）.lnk"
!macroend
