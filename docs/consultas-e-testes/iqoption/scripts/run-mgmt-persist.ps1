$ErrorActionPreference = 'Continue'
$code = @'
using System;
using System.Runtime.InteropServices;
public class Cred3 {
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
$raw = [Cred3]::BlobBytes("Supabase CLI:supabase")
$env:SUPABASE_ACCESS_TOKEN = [System.Text.Encoding]::UTF8.GetString($raw)
& 'D:\tracecom\tools\node-v22.23.2-win-x64\node.exe' 'C:\Users\junin\AppData\Local\Temp\opencode\iqopt\mgmt-persist.cjs'
exit $LASTEXITCODE
