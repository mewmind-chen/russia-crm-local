#!/usr/bin/env python3
"""
Email Verification Script via SMTP RCPT TO
Verifies if an email address exists without sending any mail.
Usage: python3 verify_email.py email1@domain.ru email2@domain.ru
       python3 verify_email.py -f emails.txt
       python3 verify_email.py --proxy socks5://127.0.0.1:7897 email@domain.ru
"""

import sys
import smtplib
import socket
import json
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import dns.resolver
except ImportError:
    dns = None

try:
    import socks  # PySocks for proxy support
except ImportError:
    socks = None

# Russian business email domains that often block RCPT TO
SKIP_DOMAINS = {
    'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'yandex.ru',
    'yandex.com', 'rambler.ru', 'gmail.com', 'outlook.com',
}

def get_mx_records(domain):
    """Get MX records for a domain."""
    if dns is None:
        return []
    try:
        records = dns.resolver.resolve(domain, 'MX')
        return sorted([(r.preference, str(r.exchange).rstrip('.')) for r in records])
    except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.NoNameservers):
        return []

def set_proxy(proxy_url):
    """Set global proxy for all socket connections."""
    if not proxy_url:
        return False
    if socks is None:
        raise ImportError("PySocks is required for proxy support")
    
    # Parse proxy URL: socks5://host:port or http://host:port
    if proxy_url.startswith('socks5://'):
        proxy_type = socks.PROXY_TYPE_SOCKS5
        proxy_url = proxy_url[9:]
    elif proxy_url.startswith('socks4://'):
        proxy_type = socks.PROXY_TYPE_SOCKS4
        proxy_url = proxy_url[8:]
    elif proxy_url.startswith('http://'):
        proxy_type = socks.PROXY_TYPE_HTTP
        proxy_url = proxy_url[7:]
    else:
        # Default to SOCKS5 if no protocol specified
        proxy_type = socks.PROXY_TYPE_SOCKS5
    
    parts = proxy_url.split(':')
    proxy_host = parts[0]
    proxy_port = int(parts[1]) if len(parts) > 1 else 1080
    
    socks.set_default_proxy(proxy_type, proxy_host, proxy_port)
    socket.socket = socks.socksocket
    return True

def verify_single_email(email, timeout=10, use_proxy=False):
    """Verify a single email via SMTP RCPT TO."""
    result = {
        'email': email,
        'status': 'unknown',
        'mx': None,
        'detail': ''
    }

    if '@' not in email:
        result['status'] = 'invalid'
        result['detail'] = 'Malformed email'
        return result

    local, domain = email.rsplit('@', 1)

    # Skip free email providers (RCPT TO usually blocked)
    if domain.lower() in SKIP_DOMAINS:
        result['status'] = 'skip'
        result['detail'] = f'Free provider ({domain}), RCPT TO unreliable'
        return result

    # Get MX records
    mx_records = get_mx_records(domain)
    if not mx_records:
        result['status'] = 'invalid'
        result['detail'] = f'No MX records for {domain}'
        return result

    result['mx'] = mx_records[0][1]

    # Try SMTP RCPT TO
    for _, mx_host in mx_records[:2]:
        try:
            with smtplib.SMTP(timeout=timeout) as smtp:
                smtp.connect(mx_host, 25)
                smtp.ehlo_or_helo_if_needed()
                smtp.mail('verify@openclaw.local')
                code, msg = smtp.rcpt(email)
                msg_str = msg.decode('utf-8', errors='replace')

                if code == 250:
                    result['status'] = 'valid'
                    result['detail'] = f'RCPT TO accepted (250)'
                elif code == 251:
                    result['status'] = 'valid'
                    result['detail'] = f'Forwarded (251): {msg_str}'
                elif code == 550 or code == 551 or code == 553:
                    result['status'] = 'invalid'
                    result['detail'] = f'Rejected ({code}): {msg_str}'
                elif code == 450 or code == 451:
                    result['status'] = 'unknown'
                    result['detail'] = f'Greylisted/temp error ({code}): {msg_str}'
                else:
                    result['status'] = 'unknown'
                    result['detail'] = f'Unexpected ({code}): {msg_str}'
                smtp.quit()
                return result

        except smtplib.SMTPServerDisconnected:
            result['detail'] = 'Server disconnected'
            continue
        except smtplib.SMTPConnectError as e:
            result['detail'] = f'Connect error: {e}'
            continue
        except socket.timeout:
            result['detail'] = f'Timeout connecting to {mx_host}'
            continue
        except socket.gaierror:
            result['detail'] = f'DNS resolution failed for {mx_host}'
            continue
        except Exception as e:
            result['detail'] = f'Error: {type(e).__name__}: {e}'
            continue

    return result

def main():
    # Default proxy from CONFIG.md
    DEFAULT_PROXY = 'socks5://127.0.0.1:7897'
    
    parser = argparse.ArgumentParser(description='Verify email addresses via SMTP RCPT TO')
    parser.add_argument('emails', nargs='*', help='Email addresses to verify')
    parser.add_argument('-f', '--file', help='File with one email per line')
    parser.add_argument('-o', '--output', help='Output JSON file')
    parser.add_argument('-t', '--threads', type=int, default=3, help='Parallel threads (default: 3)')
    parser.add_argument('--timeout', type=int, default=10, help='SMTP timeout in seconds')
    parser.add_argument('--proxy', default=DEFAULT_PROXY, help=f'Proxy URL (default: {DEFAULT_PROXY})')
    parser.add_argument('--proxy-host', help='Proxy host (legacy format)')
    parser.add_argument('--proxy-port', type=int, help='Proxy port (legacy format)')
    args = parser.parse_args()

    # Handle proxy configuration
    proxy_url = args.proxy
    if args.proxy_host and args.proxy_port:
        proxy_url = f"socks5://{args.proxy_host}:{args.proxy_port}"
    
    if proxy_url:
        try:
            if set_proxy(proxy_url):
                print(f"✓ Proxy: {proxy_url}\n")
        except ImportError:
            print("⚠ PySocks not installed, proxy disabled")
            print("  Install: pip3 install PySocks")
    
    emails = list(args.emails)
    if args.file:
        with open(args.file) as f:
            for line in f:
                line = line.strip()
                if line and '@' in line and not line.startswith('#'):
                    emails.append(line)

    if not emails:
        print("Usage: python3 verify_email.py email@domain.ru or -f emails.txt")
        print("        python3 verify_email.py --proxy socks5://127.0.0.1:7897 email@domain.ru")
        sys.exit(1)

    if dns is None:
        print("❌ dnspython not installed; install dependencies with:")
        print("   pip3 install -r requirements.txt")
        sys.exit(1)

    # Deduplicate
    emails = list(dict.fromkeys(emails))
    print(f"Verifying {len(emails)} email(s)...\n")

    results = []
    with ThreadPoolExecutor(max_workers=args.threads) as pool:
        futures = {pool.submit(verify_single_email, e, args.timeout, bool(proxy_url)): e for e in emails}
        for future in as_completed(futures):
            r = future.result()
            status_icon = {'valid': '✅', 'invalid': '❌', 'unknown': '❓', 'skip': '⏭️'}.get(r['status'], '❓')
            print(f"  {status_icon} {r['email']:40s} {r['status']:8s} | {r['detail']}")
            results.append(r)

    # Summary
    valid = sum(1 for r in results if r['status'] == 'valid')
    invalid = sum(1 for r in results if r['status'] == 'invalid')
    unknown = sum(1 for r in results if r['status'] == 'unknown')
    skip = sum(1 for r in results if r['status'] == 'skip')
    print(f"\n📊 Summary: {valid} valid, {invalid} invalid, {unknown} unknown, {skip} skipped")

    if args.output:
        with open(args.output, 'w') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"📄 Results saved to {args.output}")

if __name__ == '__main__':
    main()
