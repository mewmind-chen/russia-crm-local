#!/usr/bin/env python3
"""Recover valid Hermes JSON artifacts from failed Contact Recon runs without new model calls."""
import argparse, json, os, sqlite3
from pathlib import Path
import contact_recon_worker as worker

def main():
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--limit',type=int,default=500);args=p.parse_args()
    root=Path(__file__).resolve().parent.parent;worker.load_dotenv(root/'.env')
    db=sqlite3.connect(root/'data'/'crm.db');db.row_factory=sqlite3.Row
    jobs=db.execute("SELECT * FROM contact_recon_jobs WHERE status='failed' AND output_dir!='' ORDER BY updated_at LIMIT ?",(args.limit,)).fetchall();db.close()
    recovered=[]; skipped=[]
    for job in jobs:
        out=Path(job['output_dir'])
        try:
            stdout=(out/'hermes_stdout.txt').read_text(encoding='utf-8') if (out/'hermes_stdout.txt').exists() else ''
            value=worker.extract_result(stdout,out);value['job_id']=job['job_id'];value['customer_id']=job['customer_id']
            if args.apply:
                response=worker.post_json(worker.DEFAULT_URL,os.environ['RECON_WORKER_TOKEN'],'submitContactReconResult',{'job_id':job['job_id'],'result':value,'output_dir':str(out)})
                (out/'contact-result-v1.json').write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
                recovered.append({'job_id':job['job_id'],'summary':response.get('summary',{})})
            else: recovered.append({'job_id':job['job_id'],'people':len(value.get('people',[])),'evidence':len(value.get('evidence',[]))})
        except Exception as exc: skipped.append({'job_id':job['job_id'],'error':str(exc)[:300]})
    print(json.dumps({'apply':args.apply,'recovered':recovered,'skipped':skipped,'counts':{'recovered':len(recovered),'skipped':len(skipped)}},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
