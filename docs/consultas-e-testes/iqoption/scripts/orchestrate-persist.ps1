$ErrorActionPreference = 'Stop'
$code = @'
using System;
using System.Runtime.InteropServices;
public class Cred {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
  public static string GetSecret(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    string s = Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
    CredFree(p);
    return s;
  }
}
'@
Add-Type $code
$pw = [Cred]::GetSecret("Supabase CLI:supabase")
if (-not $pw) { "CRED_NOT_FOUND"; exit 2 }
$kind = "UNKNOWN"
if ($pw -like 'eyJ*') { $kind = "JWT_ACCESS_TOKEN" } elseif ($pw.Length -ge 8 -and $pw -notmatch '\s') { $kind = "PASSWORD_LIKE" }
"CRED kind=$kind len=$($pw.Length)"
if ($kind -ne 'PASSWORD_LIKE') { exit 3 }
$env:IQOPT_DB_PASSWORD = $pw
$env:NODE_PATH = 'D:\tracecom\tools\pgmod\node_modules'
& 'D:\tracecom\tools\node-v22.23.2-win-x64\node.exe' 'C:\Users\junin\AppData\Local\Temp\opencode\iqopt\persist.cjs'
exit $LASTEXITCODE
