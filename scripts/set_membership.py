"""Local administrator command, to be replaced/used by verified billing fulfillment."""
import argparse
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from membership import set_plan
from environment import load_environment
load_environment()
parser=argparse.ArgumentParser()
parser.add_argument('--email',required=True)
parser.add_argument('--plan',choices=['free','plus','pro'],required=True)
parser.add_argument('--days',type=int,default=30)
args=parser.parse_args()
set_plan(args.email,args.plan,args.days)
print('Membership updated on the server.')
