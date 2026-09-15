$ErrorActionPreference = 'Continue'
$code = @'
using System;
using System.Runtime.InteropServices;
public class CredEnum {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredEnumerate(string filter, int flags, out int count, out IntPtr creds);
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
  public static string[] ListTargets() {
    int count; IntPtr creds;
    if (!CredEnumerate(null, 0, out count, out creds)) return new string[0];
    var outArr = new string[count];
    for (int i = 0; i < count; i++) {
      IntPtr p = Marshal.ReadIntPtr(creds, i * IntPtr.Size);
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      outArr[i] = Marshal.PtrToStringUni(c.TargetName) + " | user=" + Marshal.PtrToStringUni(c.UserName);
    }
    CredFree(creds);
    return outArr;
  }
  public static int BlobSize(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return -1;
    CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    int n = c.CredentialBlobSize; CredFree(p); return n;
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
"=== TODAS as credenciais (targets) ==="
[CredEnum]::ListTargets() | ForEach-Object { $_ }
"=== blob analysis (sem imprimir segredo) ==="
$raw = [CredEnum]::BlobBytes("Supabase CLI:supabase")
if ($raw) {
  $u16 = [System.Text.Encoding]::Unicode.GetString($raw)
  $u8 = [System.Text.Encoding]::UTF8.GetString($raw)
  "bytes=$($raw.Length) utf16_len=$($u16.Length) utf16_printable=$(($u16 -notmatch '[\x00-\x08\x0e-\x1f]')) utf8_len=$($u8.Length) utf8_printable=$(($u8 -notmatch '[\x00-\x08\x0e-\x1f]'))"
  "utf16_charset=$(if($u16 -match '^[A-Za-z0-9!@#\$%^&*_\-\.\+]+$'){'alnum-symbols'}else{'mixed/other'})"
}
