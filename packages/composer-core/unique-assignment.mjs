// Fixed cuts use weighted augmenting-path matching. Automatic clip lengths additionally
// require a duration search; its explicit stack avoids recursion on long songs.
// A work limit is reported separately from an actual footage shortage.
export function assignUnique(tasks,{key,reserved,rng,isDraft,rating=()=>0,workLimit=2000000}){
  const used=new Set(reserved),starts=tasks.map(t=>t.start_ms),chosen=[];
  let work=0,failed=tasks[0];
  const spend=()=>{
    if(++work>workLimit){const error=new Error('Assembly reached its search limit. Try more footage, narrower folder pools, or fixed clip regions; your timeline is unchanged.');error.code='ASSEMBLY_SEARCH_LIMIT';throw error;}
  };
  const pools=tasks.map(task=>{
    const groups=new Map();
    for(const clip of task.pool){
      const id=key(clip.id);if(reserved.has(id))continue;
      if(!groups.has(id))groups.set(id,[]);
      groups.get(id).push({clip,rank:rng()});
    }
    return [...groups].map(([id,variants])=>({id,rank:rng(),variants}));
  });
  const length=c=>Math.floor(c.duration_ms);
  function candidates(i){
    const task=tasks[i],remaining=task.end_ms-starts[i],options=[];
    let capacity=0,minimum=Infinity;
    const lengths=[];
    for(const group of pools[i]){
      spend();if(used.has(group.id))continue;
      const variants=[...group.variants].sort((a,b)=>rating(b.clip)-rating(a.clip)||Number(isDraft(a.clip))-Number(isDraft(b.clip))||
        (task.region?0:Math.min(remaining,length(b.clip))-Math.min(remaining,length(a.clip)))||a.rank-b.rank);
      // Prefer the highest-rated variant, but keep longer alternatives when
      // their extra coverage could be needed to finish without repeating.
      let covered=-1;
      for(const v of variants){
        const coverage=Math.min(remaining,length(v.clip));if(coverage<=covered)continue;
        options.push({i,key:group.id,clip:v.clip,rank:group.rank,draft:isDraft(v.clip),rating:rating(v.clip)});
        covered=coverage;if(task.region)break;
      }
      const longest=Math.max(...variants.map(v=>length(v.clip)));
      capacity+=longest;lengths.push(longest);minimum=Math.min(minimum,...variants.map(v=>length(v.clip)));
    }
    options.sort((a,b)=>b.rating-a.rating||Number(a.draft)-Number(b.draft)||a.rank-b.rank);
    if(!options.length||!task.region&&capacity<remaining){failed=task;return null;}
    let need=remaining,count=0;
    for(const duration of lengths.sort((a,b)=>b-a)){need-=duration;count++;if(need<=0)break;}
    return {i,options,single:!!task.region||minimum>=remaining,count:task.region?1:count,unique:lengths.length};
  }
  function match(requests){
    const owners=new Map(),assigned=new Map(),byTask=new Map(requests.map(r=>[r.i,r]));
    // Maximize total note across fixed cuts, then prefer reviewed variants,
    // then seeded tie-breaking. Integer weights keep residual costs exact.
    const reviewWeight=1024*requests.length+1,ratingWeight=(requests.length+1)*reviewWeight;
    const score=o=>o.rating*ratingWeight+(o.draft?0:reviewWeight)+Math.floor((1-o.rank)*1024);
    for(const request of [...requests].sort((a,b)=>a.unique-b.unique||a.i-b.i)){
      let free=null,best=Infinity;
      const queue=[request.i],queued=new Set(queue),distance=new Map([[request.i,0]]),parents=new Map([[request.i,null]]);
      // Shortest augmenting path in the residual assignment graph. Unlike a
      // first-free search, this can reroute an earlier cut to keep better clips.
      for(let head=0;head<queue.length;head++){
        const i=queue[head];queued.delete(i);
        for(const option of byTask.get(i).options){
          spend();const cost=distance.get(i)-score(option);
          if(!owners.has(option.key)){if(cost<best){best=cost;free=option;}continue;}
          const owner=owners.get(option.key),nextCost=cost+score(assigned.get(owner));
          if(nextCost<(distance.get(owner)??Infinity)){
            distance.set(owner,nextCost);parents.set(owner,option);
            if(!queued.has(owner)){queue.push(owner);queued.add(owner);}
          }
        }
      }
      if(!free){failed=tasks[request.i];return null;}
      // Walk back along the augmenting path and move prior assignments.
      for(let option=free;option;option=parents.get(option.i)){
        owners.set(option.key,option.i);assigned.set(option.i,option);
      }
    }
    return [...assigned.values()].map(option=>({...option,start_ms:starts[option.i],end_ms:tasks[option.i].end_ms,task:tasks[option.i]}));
  }
  function inspect(){
    const pending=[];
    for(let i=0;i<tasks.length;i++)if(starts[i]<tasks[i].end_ms){const c=candidates(i);if(!c)return null;pending.push(c);}
    if(!pending.length)return {solution:[]};
    const allKeys=new Set(pending.flatMap(c=>c.options.map(o=>o.key)));
    if(pending.reduce((n,c)=>n+c.count,0)>allKeys.size){failed=tasks[pending[0].i];return null;}
    if(pending.every(c=>c.single)){const solution=match(pending);return solution?{solution}:null;}
    pending.sort((a,b)=>a.unique/a.count-b.unique/b.count||a.i-b.i);
    return {options:pending[0].options,index:0,assignment:null};
  }
  const first=inspect(),stack=first&&!first.solution?[first]:[];
  if(first?.solution)return first.solution;
  while(stack.length){
    const frame=stack.at(-1);
    if(frame.assignment){const a=frame.assignment;used.delete(a.key);starts[a.i]=a.start_ms;chosen.pop();frame.assignment=null;}
    if(frame.index===frame.options.length){stack.pop();continue;}
    spend();const option=frame.options[frame.index++],task=tasks[option.i],start_ms=starts[option.i];
    const assignment={...option,task,start_ms,end_ms:task.region?task.end_ms:Math.min(task.end_ms,start_ms+length(option.clip))};
    frame.assignment=assignment;chosen.push(assignment);used.add(option.key);starts[option.i]=assignment.end_ms;
    const next=inspect();if(!next)continue;
    if(next.solution)return [...chosen,...next.solution];
    stack.push(next);
  }
  const error=new Error(`Cannot fill ${failed?.section.label||'this song'} without repeating a video. Add unique footage or allow matching drafts; your current timeline is unchanged.`);
  error.code='UNIQUE_FOOTAGE';error.section_id=failed?.section.id;throw error;
}
