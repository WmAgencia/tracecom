$ErrorActionPreference = 'Continue'
$code = @'
using System;
using System.Runtime.InteropServices;
public class Cred2 {
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
  public static byte[] BlobBytes(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    byte[] b = new byte[c.CredentialBlobSize];
    Marshal.Copy(c.CredentialBlob, b, 0, c.CredentialBlobSize);
    CredFree(p); return b;
  }
}
'@
Add-Type $code
$raw = [Cred2]::BlobBytes("Supabase CLI:supabase")
$t = [System.Text.Encoding]::UTF8.GetString($raw)
"token_prefix=$($t.Substring(0,4)) len=$($t.Length) charset_ok=$($t -match '^[A-Za-z0-9_\-\.]+$')"
if ($t -like 'sbp_*') {
  $env:SUPABASE_ACCESS_TOKEN = $t
  try {
    $r = Invoke-RestMethod -Uri 'https://api.supabase.com/v1/projects/cladmauwmuoeqongxzwb' -Headers @{ Authorization = "Bearer $t" } -TimeoutSec 60
    "API_OK project=$($r.name) status=$($r.status) region=$($r.region)"
  } catch {
    "API_FAIL $($_.Exception.Message)"
    if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message.Substring(0, [Math]::Min(200, $_.ErrorDetails.Message.Length)) }
  }
}
