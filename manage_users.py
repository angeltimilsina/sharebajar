"""One-time local account administration commands."""
import argparse

from membership import AppError, normalize_email, database


def promote_admin(email):
    address=normalize_email(email)
    with database() as db:
        result=db.execute("UPDATE users SET role='admin' WHERE email=? AND disabled=0",(address,))
        if result.rowcount!=1:
            raise ValueError('An enabled account with that email was not found.')


def main():
    from environment import load_environment
    load_environment()
    parser=argparse.ArgumentParser(description='Manage ShareBajar administrator access.')
    subparsers=parser.add_subparsers(dest='command',required=True)
    promote=subparsers.add_parser('promote-admin',help='Promote an existing enabled account to administrator.')
    promote.add_argument('email')
    args=parser.parse_args()
    try:
        if args.command=='promote-admin':
            promote_admin(args.email)
            print('Administrator access granted.')
    except (AppError,ValueError,RuntimeError) as exc:
        parser.error(str(exc))


if __name__=='__main__':
    main()
