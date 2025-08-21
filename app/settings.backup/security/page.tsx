'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Shield, Smartphone, Key, AlertTriangle, Check, X, Copy } from 'lucide-react';
import Image from 'next/image';

export default function SecuritySettingsPage() {
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    checkTwoFactorStatus();
  }, []);

  const checkTwoFactorStatus = async () => {
    try {
      const response = await fetch('/api/auth/2fa/disable', {
        method: 'GET',
      });
      const data = await response.json();
      setTwoFactorEnabled(data.enabled);
    } catch (error) {
      console.error('Error checking 2FA status:', error);
    }
  };

  const setupTwoFactor = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/2fa/setup', {
        method: 'POST',
      });
      const data = await response.json();
      
      if (response.ok) {
        setQrCode(data.qrCode);
        setSecret(data.secret);
        setBackupCodes(data.backupCodes);
        setShowSetup(true);
      }
    } catch (error) {
      console.error('Error setting up 2FA:', error);
    }
    setLoading(false);
  };

  const verifyAndEnable = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/2fa/setup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verificationCode }),
      });
      
      if (response.ok) {
        setTwoFactorEnabled(true);
        setShowSetup(false);
        setVerificationCode('');
      }
    } catch (error) {
      console.error('Error verifying 2FA:', error);
    }
    setLoading(false);
  };

  const disableTwoFactor = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          password, 
          code: verificationCode 
        }),
      });
      
      if (response.ok) {
        setTwoFactorEnabled(false);
        setShowDisable(false);
        setPassword('');
        setVerificationCode('');
      }
    } catch (error) {
      console.error('Error disabling 2FA:', error);
    }
    setLoading(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Security Settings</h1>
        <p className="text-gray-600">
          Manage your account security and authentication methods
        </p>
      </div>

      {/* Two-Factor Authentication */}
      <Card className="p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Shield className="text-blue-600" size={24} />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-2">Two-Factor Authentication</h2>
              <p className="text-gray-600 mb-4">
                Add an extra layer of security to your account by requiring a verification code in addition to your password.
              </p>
              <div className="flex items-center gap-2 mb-4">
                {twoFactorEnabled ? (
                  <>
                    <Check className="text-green-500" size={20} />
                    <span className="text-green-600 font-medium">Enabled</span>
                  </>
                ) : (
                  <>
                    <X className="text-gray-400" size={20} />
                    <span className="text-gray-500">Not enabled</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {!twoFactorEnabled && !showSetup && (
          <Button onClick={setupTwoFactor} disabled={loading}>
            <Smartphone className="mr-2" size={16} />
            Set Up Two-Factor Authentication
          </Button>
        )}

        {twoFactorEnabled && !showDisable && (
          <Button 
            variant="outline" 
            onClick={() => setShowDisable(true)}
            className="text-red-600 hover:text-red-700"
          >
            Disable Two-Factor Authentication
          </Button>
        )}
      </Card>

      {/* Setup 2FA Modal */}
      {showSetup && (
        <Card className="p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Set Up Two-Factor Authentication</h3>
          
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-600 mb-2">
                1. Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
              </p>
              {qrCode && (
                <div className="bg-white p-4 rounded-lg border inline-block">
                  <img src={qrCode} alt="2FA QR Code" className="w-48 h-48" />
                </div>
              )}
            </div>

            <div>
              <p className="text-sm text-gray-600 mb-2">
                2. Or enter this secret key manually:
              </p>
              <div className="flex items-center gap-2">
                <code className="bg-gray-100 px-3 py-2 rounded text-sm flex-1">
                  {secret}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(secret)}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </Button>
              </div>
            </div>

            <div>
              <p className="text-sm text-gray-600 mb-2">
                3. Enter the verification code from your app:
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="000000"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  className="px-3 py-2 border rounded-lg flex-1"
                  maxLength={6}
                />
                <Button 
                  onClick={verifyAndEnable}
                  disabled={loading || verificationCode.length !== 6}
                >
                  Verify & Enable
                </Button>
              </div>
            </div>

            {backupCodes.length > 0 && (
              <div className="mt-6 p-4 bg-yellow-50 rounded-lg">
                <div className="flex items-start gap-2 mb-3">
                  <AlertTriangle className="text-yellow-600 mt-0.5" size={20} />
                  <div>
                    <h4 className="font-semibold text-yellow-800">Save Your Backup Codes</h4>
                    <p className="text-sm text-yellow-700 mt-1">
                      Store these codes in a safe place. You can use them to access your account if you lose your device.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {backupCodes.map((code, index) => (
                    <code key={index} className="bg-white px-2 py-1 rounded text-sm">
                      {code}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-6">
            <Button
              variant="outline"
              onClick={() => {
                setShowSetup(false);
                setQrCode('');
                setSecret('');
                setBackupCodes([]);
                setVerificationCode('');
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Disable 2FA Modal */}
      {showDisable && (
        <Card className="p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Disable Two-Factor Authentication</h3>
          
          <div className="p-4 bg-yellow-50 rounded-lg mb-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="text-yellow-600 mt-0.5" size={20} />
              <div>
                <p className="text-sm text-yellow-700">
                  Disabling two-factor authentication will make your account less secure. 
                  You&apos;ll need to enter your password and a verification code to continue.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="Enter your password"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Verification Code</label>
              <input
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="000000 or backup code"
                maxLength={8}
              />
            </div>
          </div>

          <div className="flex gap-2 mt-6">
            <Button
              variant="outline"
              onClick={() => {
                setShowDisable(false);
                setPassword('');
                setVerificationCode('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={disableTwoFactor}
              disabled={loading || !password || !verificationCode}
              className="bg-red-600 hover:bg-red-700"
            >
              Disable 2FA
            </Button>
          </div>
        </Card>
      )}

      {/* Additional Security Settings */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Security Recommendations</h2>
        
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Key className="text-gray-400 mt-1" size={20} />
            <div>
              <h3 className="font-medium mb-1">Use a strong password</h3>
              <p className="text-sm text-gray-600">
                Use a unique password that&apos;s at least 12 characters long with a mix of letters, numbers, and symbols.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Shield className="text-gray-400 mt-1" size={20} />
            <div>
              <h3 className="font-medium mb-1">Enable two-factor authentication</h3>
              <p className="text-sm text-gray-600">
                Add an extra layer of security by requiring a verification code when signing in.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <AlertTriangle className="text-gray-400 mt-1" size={20} />
            <div>
              <h3 className="font-medium mb-1">Review account activity</h3>
              <p className="text-sm text-gray-600">
                Regularly check your account activity and sign out of devices you don&apos;t recognize.
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}