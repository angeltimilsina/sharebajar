"""Private, account-owned AI conversation history."""
import json
import secrets
import time

from membership import AppError, database

MAX_CONVERSATIONS=100
MAX_MESSAGES=100
MAX_RESULT_BYTES=100_000


def list_conversations(user_id,limit=50,offset=0):
    limit=max(1,min(50,int(limit)))
    offset=max(0,int(offset))
    with database() as db:
        total=db.execute('SELECT COUNT(*) FROM research_conversations WHERE user_id=?',(user_id,)).fetchone()[0]
        rows=db.execute('SELECT id,title,created_at,updated_at FROM research_conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?',(user_id,limit,offset)).fetchall()
    return {'conversations':[dict(row) for row in rows],'total':total,'limit':limit,'offset':offset}


def get_conversation(user_id,conversation_id):
    with database() as db:
        conversation=db.execute('SELECT id,title,created_at,updated_at FROM research_conversations WHERE id=? AND user_id=?',(conversation_id,user_id)).fetchone()
        if not conversation:raise AppError('Conversation not found.',404,'conversation_not_found')
        rows=db.execute('SELECT id,role,content,payload,created_at FROM research_messages WHERE conversation_id=? ORDER BY created_at,id',(conversation_id,)).fetchall()
    messages=[]
    for row in rows:
        item=dict(row)
        item['payload']=json.loads(item.pop('payload'))
        messages.append(item)
    return {'conversation':dict(conversation),'messages':messages}


def history_for_model(user_id,conversation_id):
    if not conversation_id:return []
    with database() as db:
        conversation=db.execute('SELECT id FROM research_conversations WHERE id=? AND user_id=?',(conversation_id,user_id)).fetchone()
        if not conversation:raise AppError('Conversation not found.',404,'conversation_not_found')
        rows=db.execute('SELECT role,content FROM research_messages WHERE conversation_id=? ORDER BY created_at DESC,id DESC LIMIT 16',(conversation_id,)).fetchall()
    turns=[];question=None
    for row in reversed(rows):
        if row['role']=='user':question=row['content']
        elif row['role']=='assistant' and question is not None:
            turns.append({'question':question,'takeaway':row['content']});question=None
    return turns[-8:]


def save_exchange(user_id,conversation_id,prompt,result,user_payload=None):
    if not isinstance(prompt,str) or not prompt.strip() or len(prompt)>2000:
        raise AppError('Enter a research question up to 2,000 characters.')
    safe_result=json.dumps(result,allow_nan=False,separators=(',',':'))
    if len(safe_result.encode('utf-8'))>MAX_RESULT_BYTES:raise AppError('This research response is too large to save. Narrow the research and try again.',413,'history_result_too_large')
    interpretation=result.get('interpretation') or {}
    report=interpretation.get('report') or {}
    answer=report.get('summary') or result.get('takeaway') or 'Research completed. Review the charts, indicators, and source limitations.'
    now=time.time()
    title=None
    with database() as db:
        if conversation_id:
            conversation=db.execute('SELECT id FROM research_conversations WHERE id=? AND user_id=?',(conversation_id,user_id)).fetchone()
            if not conversation:raise AppError('Conversation not found.',404,'conversation_not_found')
            count=db.execute('SELECT COUNT(*) FROM research_messages WHERE conversation_id=?',(conversation_id,)).fetchone()[0]
            if count+2>MAX_MESSAGES:raise AppError('This conversation reached its message limit. Start a new research chat.',409,'conversation_limit')
        else:
            count=db.execute('SELECT COUNT(*) FROM research_conversations WHERE user_id=?',(user_id,)).fetchone()[0]
            if count>=MAX_CONVERSATIONS:raise AppError('Your research history is full. Delete an old conversation before starting another.',409,'history_limit')
            conversation_id=secrets.token_hex(16)
            title=' '.join(prompt.split())[:100]
            db.execute('INSERT INTO research_conversations VALUES(?,?,?,?,?)',(conversation_id,user_id,title,now,now))
        db.execute('INSERT INTO research_messages VALUES(?,?,?,?,?,?)',(secrets.token_hex(16),conversation_id,'user',prompt.strip(),json.dumps(user_payload or {},allow_nan=False,separators=(',',':')),now))
        db.execute('INSERT INTO research_messages VALUES(?,?,?,?,?,?)',(secrets.token_hex(16),conversation_id,'assistant',str(answer)[:6000],safe_result,now+0.000001))
        db.execute('UPDATE research_conversations SET updated_at=? WHERE id=?',(now,conversation_id))
    return {'conversationId':conversation_id,'title':title,'createdAt':now,'updatedAt':now,'answer':str(answer)[:6000]}


def delete_conversation(user_id,conversation_id):
    with database() as db:
        conversation=db.execute('SELECT id FROM research_conversations WHERE id=? AND user_id=?',(conversation_id,user_id)).fetchone()
        if not conversation:raise AppError('Conversation not found.',404,'conversation_not_found')
        db.execute('DELETE FROM research_messages WHERE conversation_id=?',(conversation_id,))
        db.execute('DELETE FROM research_conversations WHERE id=? AND user_id=?',(conversation_id,user_id))
    return {'deleted':True}
