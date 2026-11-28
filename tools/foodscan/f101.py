# Food-101 (nur zur Messung, keine Weitergabe der Bilder): N Bilder je relevanter Klasse aus dem Validierungs-Parquet extrahieren
import pyarrow.parquet as pq, io, os, sys, json, urllib.request
N=int(sys.argv[1]) if len(sys.argv)>1 else 20
CLS=json.load(open('tools/foodscan/f101map.json'))
os.makedirs('/tmp/f101',exist_ok=True); cnt={}
for part in range(3):
    url=f'https://huggingface.co/datasets/ethz/food101/resolve/main/data/validation-0000{part}-of-00003.parquet'
    fn=f'/tmp/f101_{part}.parquet'
    if not os.path.exists(fn): urllib.request.urlretrieve(url,fn)
    t=pq.read_table(fn); names=t.schema.field('label').type
    labels=t.column('label').to_pylist(); imgs=t.column('image').to_pylist()
    meta=pq.read_schema(fn).metadata or {}
    feat=json.loads(meta.get(b'huggingface',b'{}')).get('info',{}).get('features',{}).get('label',{}).get('names',[])
    for lab,im in zip(labels,imgs):
        name=feat[lab] if feat else str(lab)
        if name not in CLS or cnt.get(name,0)>=N: continue
        cnt[name]=cnt.get(name,0)+1; os.makedirs(f'/tmp/f101/{name}',exist_ok=True)
        open(f'/tmp/f101/{name}/{cnt[name]}.jpg','wb').write(im['bytes'])
    if all(cnt.get(c,0)>=N for c in CLS): break
print(json.dumps(cnt))
