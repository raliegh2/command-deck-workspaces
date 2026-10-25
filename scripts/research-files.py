"""Local parsing and export helpers. No network, code execution, or model calls."""
from pathlib import Path
from html.parser import HTMLParser
from html import escape
from collections import Counter
import sys,json,csv,re,zipfile,base64,math

class VisibleHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.skip=0;self.in_title=False;self.parts=[];self.title=[];self.meta={};self.links=[];self.tables=[];self.table=None;self.row=None;self.cell=None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='a' and a.get('href'):self.links.append(a['href'])
        if tag=='table':self.table=[]
        if tag=='tr' and self.table is not None:self.row=[]
        if tag in ['td','th'] and self.row is not None:self.cell=[]
        if tag in ['script','style','svg','noscript','template']:self.skip+=1
        if tag=='title':self.in_title=True
        if tag=='meta':
            key=a.get('name') or a.get('property')
            if key and a.get('content'):self.meta[key.lower()]=a['content'][:1000]
        if tag in ['p','div','li','tr','h1','h2','h3','br']:self.parts.append('\n')
    def handle_endtag(self,tag):
        if tag in ['td','th'] and self.cell is not None:
            self.row.append(' '.join(' '.join(self.cell).split())[:500]);self.cell=None
        if tag=='tr' and self.row is not None and self.table is not None:self.table.append(self.row);self.row=None
        if tag=='table' and self.table is not None:self.tables.append(self.table[:51]);self.table=None
        if tag in ['script','style','svg','noscript','template']:self.skip=max(0,self.skip-1)
        if tag=='title':self.in_title=False
    def handle_data(self,data):
        if self.cell is not None and not self.skip:self.cell.append(data)
        if self.in_title:self.title.append(data)
        if not self.skip:self.parts.append(data+' ')

def parse(source):
    p=VisibleHTML();p.feed(source.get('html',''));full='\n'.join(' '.join(x.split()) for x in ''.join(p.parts).splitlines() if x.strip())
    text=full[:24000]
    return {'title':' '.join(' '.join(p.title).split())[:250],'text':text,'meta':p.meta,'links':p.links[:300],'tables':p.tables[:10],'truncated':len(full)>24000}

def pdf_parse(file):
    import pdfplumber
    with pdfplumber.open(file) as doc:
        pages=doc.pages[:15];text='\n'.join(p.extract_text() or '' for p in pages)
        tables=[t for p in pages for t in (p.extract_tables() or [])][:10]
        return {'title':Path(file).stem,'text':text[:24000],'meta':{},'links':[],'tables':tables,'truncated':len(doc.pages)>15 or len(text)>24000}

def export(folder):
    from docx import Document
    from docx.shared import Inches,Pt
    from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,Image as PDFImage
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib import colors
    from PIL import Image,ImageDraw,ImageFont,PngImagePlugin
    from openpyxl import Workbook
    from openpyxl.styles import Font,PatternFill
    d=json.loads((folder/'dataset.json').read_text(encoding='utf-8'));fields=d['fields'];rows=d['records'];sources=d['sources'];title=d['prompt'][:140]
    kind=d.get('input',{}).get('reportType','research')
    if kind!='research':title=('Comparison: ' if kind=='comparison' else 'Research brief: ')+title
    def cell(value):
        s=re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]',' ','' if value is None else str(value))
        return "'"+s if s.lstrip().startswith(('=','+','-','@','\t','\r')) else s
    headers=['source_id']+fields
    values=[[r['sourceId']]+[cell(r['values'].get(f)) for f in fields] for r in rows]
    with (folder/'data.csv').open('w',newline='',encoding='utf-8-sig') as f:
        w=csv.writer(f);w.writerow(headers);w.writerows(values)
    wb=Workbook();ws=wb.active;ws.title='Research data';ws.append(headers)
    for row in values:ws.append(row)
    for c in ws[1]:c.font=Font(bold=True,color='FFFFFF');c.fill=PatternFill('solid',fgColor='9F3517')
    ws.freeze_panes='B2';ws.auto_filter.ref=ws.dimensions
    for col in ws.columns:ws.column_dimensions[col[0].column_letter].width=28
    src=wb.create_sheet('Sources');src.append(['id','url','retrieved_at','status'])
    for s in sources:src.append([s['id'],cell(s['url']),s['at'],s['status']])
    wb.save(folder/'data.xlsx')
    counts=Counter(s.get('host','unknown') for s in sources if s['status']=='collected');image=Image.new('RGB',(1400,900),'#f5f5f8');draw=ImageDraw.Draw(image)
    def font(size):
        for p in ['C:/Windows/Fonts/arial.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
            try:return ImageFont.truetype(p,size)
            except OSError:pass
        return ImageFont.load_default()
    draw.rectangle((0,0,1400,12),fill='#b8401b');draw.text((65,55),'RESEARCH COLLECTION',font=font(24),fill='#9f3517')
    import textwrap
    draw.multiline_text((65,105),'\n'.join(textwrap.wrap(title,65))[:260],font=font(32),fill='#24242d',spacing=8)
    draw.text((65,265),f"{len(rows)} records   |   {sum(s['status']=='collected' for s in sources)} pages collected",font=font(30),fill='#24242d')
    draw.text((65,330),'Collected pages by source domain',font=font(24),fill='#646471')
    maximum=max(counts.values(),default=1)
    for i,(host,count) in enumerate(counts.most_common(6)):
        y=390+i*65;draw.text((65,y),host[:40],font=font(21),fill='#24242d');draw.rectangle((610,y,610+int(620*count/maximum),y+30),fill='#b8401b');draw.text((1250,y),str(count),font=font(22),fill='#24242d')
    draw.text((65,815),'Collection coverage only; not a market prediction or measure of source reliability.',font=font(19),fill='#646471');draw.text((65,850),d['createdAt'],font=font(17),fill='#646471')
    meta=PngImagePlugin.PngInfo();meta.add_text('Description','Programmatic chart of actual collected-page counts by domain; source dataset.json. No AI-generated imagery.');image.save(folder/'coverage.png',pnginfo=meta)
    summary=Image.new('RGB',(1400,900),'white');ink=ImageDraw.Draw(summary);ink.rectangle((0,0,16,900),fill='#b8401b');ink.text((75,55),'RESEARCH EVIDENCE SUMMARY',font=font(24),fill='#9f3517');ink.multiline_text((75,120),'\n'.join(textwrap.wrap(title,63))[:260],font=font(32),fill='#24242d',spacing=8)
    total=len(rows)*len(fields);found=sum(r['values'].get(f) is not None for r in rows for f in fields);metrics=[(str(len(rows)),'source-linked records'),(str(sum(s['status']=='collected' for s in sources)),'pages collected'),(str(found)+' / '+str(total),'requested fields found')]
    for i,(number,label) in enumerate(metrics):
        x=75+i*440;ink.text((x,300),number,font=font(54),fill='#24242d');ink.text((x,380),label,font=font(23),fill='#646471')
    ink.text((75,495),'Data completeness',font=font(26),fill='#24242d');ink.rectangle((75,555,1315,605),fill='#eeeef3')
    if total and found:ink.rectangle((75,555,75+int(1240*found/total),605),fill='#b8401b')
    ink.text((75,645),str(total-found)+' missing values remain unknown, not zero.',font=font(27),fill='#646471');ink.text((75,770),'Counts describe this collection, not source reliability or predictive accuracy.',font=font(21),fill='#646471');ink.text((75,825),d['createdAt'],font=font(18),fill='#646471');summary.save(folder/'summary.png',pnginfo=meta)
    report_rows=rows[:8] if kind=='brief' else rows
    report_values=values[:8] if kind=='brief' else values
    if kind=='brief' and len(rows)>8:d['warnings']=d.get('warnings',[])+['Brief shows first eight records; full dataset remains in CSV/XLSX/JSON.']
    md=['# '+title,'','Created: '+d['createdAt'],'','## Findings and coverage','',d['summary'],'','## Data','', '| '+' | '.join(headers)+' |','| '+' | '.join(['---']*len(headers))+' |']
    for row in report_values:md.append('| '+' | '.join(str(v).replace('|','\\|').replace('\n',' ')[:500] for v in row)+' |')
    md+=['','## Sources','']+[f"- [{s['id']}] {s.get('title','Source')} — {s['url']} — {s['status']} — {s.get('reason','')}" for s in sources]
    md+=['','## Limits','','Public pages only. Missing fields stay empty; source text is untrusted evidence. Model-extracted values require literal source support. Collection does not establish causation or predictive accuracy.']
    if d.get('warnings'):md+=['','## Warnings','']+['- '+w for w in d['warnings']]
    (folder/'report.md').write_text('\n'.join(md),encoding='utf-8')
    doc=Document();doc.add_heading('Research report',0);doc.add_paragraph(title);doc.add_paragraph('Created '+d['createdAt']);doc.add_heading('Coverage',1);doc.add_paragraph(d['summary']);doc.add_picture(str(folder/'coverage.png'),width=Inches(6))
    for index,row in enumerate(report_rows):
        doc.add_heading('Record '+str(index+1)+' — '+row['sourceId'],2)
        for field in fields:doc.add_paragraph(field+': '+str(row['values'].get(field) or 'Not found'))
    if kind=='comparison' and rows:
        doc.add_heading('Side-by-side comparison (first four records)',1)
        grid=doc.add_table(rows=1,cols=1+min(4,len(rows)));grid.style='Table Grid'
        for i,label in enumerate(['Field']+[r['sourceId'] for r in rows[:4]]):grid.rows[0].cells[i].text=label
        for field in fields:
            cells=grid.add_row().cells;cells[0].text=field
            for i,row in enumerate(rows[:4]):cells[i+1].text=str(row['values'].get(field) or 'Not found')
    doc.add_heading('Collection notes',1)
    for warning in d.get('warnings',[]):doc.add_paragraph(warning)
    doc.add_heading('Sources and limitations',1)
    for s in sources:doc.add_paragraph(s['id']+' — '+s['url']+' — '+s['status']+' — '+s['at'])
    doc.add_paragraph('Missing fields remain unknown. Synthetic or collected data do not establish predictive accuracy. Review evidence before reuse.');doc.save(folder/'report.docx')
    styles=getSampleStyleSheet();story=[Paragraph('Research report',styles['Title']),Paragraph(escape(title),styles['Heading2']),Paragraph(escape(d['summary']),styles['BodyText']),Spacer(1,12),PDFImage(str(folder/'coverage.png'),width=480,height=309)]
    for index,row in enumerate(report_rows):
        story.append(Paragraph('Record '+str(index+1)+' — '+row['sourceId'],styles['Heading2']))
        for field in fields:story.append(Paragraph(escape(field+': '+str(row['values'].get(field) or 'Not found'))[:4000],styles['BodyText']))
    if kind=='comparison' and rows:
        story.append(Paragraph('Side-by-side comparison (first four records)',styles['Heading1']))
        matrix=[['Field']+[r['sourceId'] for r in rows[:4]]]+[[f]+[Paragraph(escape(str(r['values'].get(f) or 'Not found')),styles['BodyText']) for r in rows[:4]] for f in fields]
        comparison=Table(matrix,colWidths=[480/(1+min(4,len(rows)))]*(1+min(4,len(rows))),repeatRows=1);comparison.setStyle(TableStyle([('GRID',(0,0),(-1,-1),.5,colors.lightgrey),('VALIGN',(0,0),(-1,-1),'TOP')]));story.append(comparison)
    story.append(Paragraph('Collection notes',styles['Heading1']))
    for warning in d.get('warnings',[]):story.append(Paragraph(escape(warning),styles['BodyText']))
    story.append(Paragraph('Sources',styles['Heading1']))
    for s in sources:story.append(Paragraph(escape(s['id']+' — '+s['url']+' — '+s['status']+' — '+s['at']),styles['BodyText']))
    SimpleDocTemplate(str(folder/'report.pdf'),title='Research report',author='Command Deck',topMargin=42,bottomMargin=42).build(story)
    html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Research report</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:20px;color:#24242d}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:10px;text-align:left;overflow-wrap:anywhere}img{max-width:100%}h1{color:#9f3517}</style><h1>'+escape(title)+'</h1><p>'+escape(d['summary'])+'</p><img src="data:image/png;base64,'+base64.b64encode((folder/'coverage.png').read_bytes()).decode('ascii')+'" alt="Collection coverage by source domain"><table><tr>'+''.join('<th>'+escape(h)+'</th>' for h in headers)+'</tr>'+''.join('<tr>'+''.join('<td>'+escape(str(c))+'</td>' for c in row)+'</tr>' for row in report_values)+'</table><h2>Sources</h2>'+''.join('<p>'+escape(s['id']+' '+s['url']+' '+s['status'])+'</p>' for s in sources)+'</html>'
    html=html.replace('</html>','<h2>Collection notes</h2>'+''.join('<p>'+escape(w)+'</p>' for w in d.get('warnings',[]))+'</html>')
    (folder/'report.html').write_text(html,encoding='utf-8')
    numeric=[];chart_field=None
    for field in fields:
        if not re.search(r'(?:price|cost|rating|score|count|amount|revenue|growth|sales|quantity|total|percent)',field):continue
        candidates=[]
        for r in rows:
            value=r['values'].get(field);m=re.fullmatch(r'\s*([$£€]?)\s*(\d[\d,]*(?:\.\d+)?)\s*(%?)\s*',str(value or ''))
            if m and math.isfinite(float(m.group(2).replace(',',''))) and float(m.group(2).replace(',',''))<=1e15:candidates.append((r['values'].get('title') or r['values'].get('name') or r['sourceId'],float(m.group(2).replace(',','')),m.group(1)+m.group(3)+(r['values'].get('currency') or ''),value))
        if len(candidates)>=2 and len(set(x[2] for x in candidates))==1:
            numeric=candidates[:8];chart_field=field;break
    if numeric:
        im=Image.new('RGB',(1400,900),'white');ink=ImageDraw.Draw(im);ink.text((65,65),'COLLECTED VALUES: '+chart_field.upper(),font=font(32),fill='#24242d');ink.text((65,125),'Same-field comparison; values and units are copied from collected sources.',font=font(22),fill='#646471');maximum=max(x[1] for x in numeric) or 1
        for i,(label,value,unit,display) in enumerate(numeric):
            y=210+i*68;ink.text((65,y),str(label)[:35],font=font(20),fill='#24242d');ink.rectangle((590,y,590+int(570*value/maximum),y+30),fill='#b8401b');ink.text((1190,y),str(display)[:20],font=font(20),fill='#24242d')
        ink.text((65,825),'Source-linked observations; not a prediction. Verify currency and source context.',font=font(21),fill='#646471');im.save(folder/'values.png',pnginfo=meta)
    names=['dataset.json','data.csv','data.xlsx','report.md','report.docx','report.pdf','report.html','coverage.png','summary.png']
    if numeric:names.append('values.png')
    with zipfile.ZipFile(folder/'research-bundle.zip','w',zipfile.ZIP_DEFLATED) as z:
        for n in names:z.write(folder/n,n)
    return names+['research-bundle.zip']

if __name__=='__main__':
    if sys.argv[1]=='parse':
        source=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'));print(json.dumps(parse(source),ensure_ascii=True))
    elif sys.argv[1]=='document':
        from research_document import export_document
        print(json.dumps({'files':export_document(Path(sys.argv[2]))}))
    elif sys.argv[1]=='export':print(json.dumps({'files':export(Path(sys.argv[2]))}))
    elif sys.argv[1]=='pdf':print(json.dumps(pdf_parse(sys.argv[2]),ensure_ascii=True))
