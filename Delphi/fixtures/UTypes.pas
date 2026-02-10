/// Unit UTypes: Delphi-Typsystem-Fixture.
/// Testet: Enums, Records (mit Feldern), Type-Aliase,
/// Konstanten, verschachtelte Typen, Class-Methoden (static).
unit UTypes;

interface

uses
  System.SysUtils;

const
  C_MAX_RETRIES = 3;
  C_DEFAULT_NAME = 'Guest';

type
  /// Enum: Benutzerrolle
  TUserRole = (urAdmin, urEditor, urViewer);

  /// Record: Punkt mit X/Y-Koordinaten
  TPoint2D = record
    X: Double;
    Y: Double;
  end;

  /// Type-Alias
  TUserName = string;

  /// Klasse mit class method (static), verschachteltem Typ und Enum-Verwendung
  TUserInfo = class
  public
    type
      /// Verschachtelter Record innerhalb der Klasse
      TAddress = record
        Street: string;
        City: string;
        Zip: string;
      end;
  private
    FName: TUserName;
    FRole: TUserRole;
    FAddress: TAddress;
  public
    constructor Create(const AName: TUserName; ARole: TUserRole);
    function GetDisplayName: string;
    class function CreateAdmin(const AName: TUserName): TUserInfo; static;
    property Name: TUserName read FName write FName;
    property Role: TUserRole read FRole;
    property Address: TAddress read FAddress write FAddress;
  end;

implementation

{ TUserInfo }

constructor TUserInfo.Create(const AName: TUserName; ARole: TUserRole);
begin
  FName := AName;
  FRole := ARole;
end;

function TUserInfo.GetDisplayName: string;
begin
  if FRole = urAdmin then
    Result := '[Admin] ' + FName
  else
    Result := FName;
end;

class function TUserInfo.CreateAdmin(const AName: TUserName): TUserInfo;
begin
  Result := TUserInfo.Create(AName, urAdmin);
end;

end.

