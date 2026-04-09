@echo off
setlocal
:: Get the current date in YYYY-MM-DD format
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /format:list') do set datetime=%%I
set datestamp=%datetime:~0,4%-%datetime:~4,2%-%datetime:~6,2%

echo Starting Backup for Danprel Database...
echo Date: %datestamp%

:: Run the mongodump command (Update the path to wherever your mongodump.exe is located)
:: Defaulting to the path from your screenshot
"C:\Users\WELCOME\Downloads\mongodb-database-tools-windows-x86_64-100.16.0\mongodb-database-tools-windows-x86_64-100.16.0\bin\mongodump.exe" --uri="mongodb+srv://divyadharsnidivya05_db_user:rZJmY56Dc1QYvJKj@danprel-cluster.vlqzfx0.mongodb.net/danprel" --out="C:\Users\WELCOME\OneDrive\Desktop\Danprel_Backup_%datestamp%"

echo.
echo Backup Complete! 
echo Check your Desktop for folder: Danprel_Backup_%datestamp%
echo.
pause
