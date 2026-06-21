Get-NetTCPConnection -LocalPort 7333 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  if ($proc) { Stop-Process -Id $proc.Id -Force }
}
Start-Sleep -Seconds 2
Start-Process -FilePath 'node' -ArgumentList 'scripts/launch-yytek-web.cjs' -WorkingDirectory 'D:\code\codegraph-springcloud' -WindowStyle Hidden -RedirectStandardOutput 'logs/web-server.log' -RedirectStandardError 'logs/web-server.err.log'
Start-Sleep -Seconds 5
Get-NetTCPConnection -LocalPort 7333 -State Listen | Select-Object LocalPort,State,OwningProcess
