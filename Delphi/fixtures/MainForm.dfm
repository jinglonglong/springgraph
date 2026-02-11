object frmMain: TfrmMain
  Left = 0
  Top = 0
  Caption = 'CodeGraph DFM Fixture'
  ClientHeight = 480
  ClientWidth = 640
  Color = clBtnFace
  Font.Charset = DEFAULT_CHARSET
  Font.Color = clWindowText
  Font.Height = -12
  Font.Name = 'Segoe UI'
  OnCreate = FormCreate
  OnDestroy = FormDestroy
  PixelsPerInch = 96
  TextHeight = 15
  object pnlTop: TPanel
    Left = 0
    Top = 0
    Width = 640
    Height = 50
    Align = alTop
    BevelOuter = bvNone
    TabOrder = 0
    object lblTitle: TLabel
      Left = 16
      Top = 16
      Width = 200
      Height = 15
      Caption = 'Authentication Service'
    end
    object btnLogin: TButton
      Left = 540
      Top = 12
      Width = 80
      Height = 25
      Caption = 'Login'
      TabOrder = 0
      OnClick = btnLoginClick
    end
  end
  object pnlContent: TPanel
    Left = 0
    Top = 50
    Width = 640
    Height = 390
    Align = alClient
    BevelOuter = bvNone
    TabOrder = 1
    object edtUsername: TEdit
      Left = 16
      Top = 16
      Width = 300
      Height = 23
      TabOrder = 0
      TextHint = 'Username'
      OnChange = edtUsernameChange
    end
    object edtPassword: TEdit
      Left = 16
      Top = 48
      Width = 300
      Height = 23
      PasswordChar = '*'
      TabOrder = 1
      TextHint = 'Password'
      OnKeyPress = edtPasswordKeyPress
    end
    object mmoLog: TMemo
      Left = 16
      Top = 88
      Width = 608
      Height = 280
      ReadOnly = True
      ScrollBars = ssVertical
      TabOrder = 2
    end
  end
  object pnlStatus: TStatusBar
    Left = 0
    Top = 440
    Width = 640
    Height = 40
    Panels = <
      item
        Width = 200
      end
      item
        Width = 200
      end>
  end
end

