import test from 'node:test';
import assert from 'node:assert/strict';
import { SecondBoxPrompts } from '../src/experience/secondBoxPrompts.ts';

const rising = {visible:true,settled:false}, seated = {visible:true,settled:true}, hidden = {visible:false,settled:false};

test('sit speech waits for successful completed appearance and plays once per reveal', () => {
  const events: string[]=[];
  const prompts=new SecondBoxPrompts({onSit:()=>events.push('sit'),onClassroom:()=>events.push('classroom')});
  prompts.update(10,seated); assert.deepEqual(events,[], 'an unrequested diagnostic pose must not start speech');
  prompts.requestSit(true);prompts.requestSit();prompts.update(11,rising);
  assert.deepEqual(events,[]);
  prompts.update(12.5,seated);prompts.update(13,seated);prompts.requestSit();prompts.update(100,seated);
  assert.deepEqual(events,['sit'], 'repeated cues/visible frames must not replay the instruction or start classroom speech');
  prompts.update(101,hidden);prompts.requestSit(true);prompts.update(102,seated);
  assert.deepEqual(events,['sit','sit']);
});

test('classroom deadline starts at actual wall appearance, independent of seat waiting and wall motion', () => {
  const events: string[]=[];
  const prompts=new SecondBoxPrompts({onSit:()=>events.push('sit'),onClassroom:()=>events.push('classroom')});
  prompts.requestSit(true);prompts.update(1,seated);prompts.update(20,seated);
  assert.deepEqual(events,['sit'], 'waiting for the player/look-away must not run the classroom clock');
  assert.ok(prompts.wallAppeared(20)); assert.equal(prompts.snapshot().classroomAt,25);
  assert.equal(prompts.wallAppeared(22),false,'a duplicate reveal cannot postpone the deadline');
  prompts.update(24.999,seated);assert.deepEqual(events,['sit']);
  prompts.update(25,seated);prompts.update(100,seated);assert.deepEqual(events,['sit','classroom']);
  assert.equal(prompts.wallAppeared(100),false,'one appearance has only one instruction');
});

test('wall cancellation, recovery, invalid clocks and cancelled rises suppress pending instructions', () => {
  for(const cancel of ['cancelWall','reset'] as const){
    const events: string[]=[];
    const prompts=new SecondBoxPrompts({onSit:()=>events.push('sit'),onClassroom:()=>events.push('classroom')});
    prompts.wallAppeared(5);prompts.update(9,seated);prompts[cancel]();prompts.update(100,hidden);
    assert.deepEqual(events,[]);
    assert.ok(prompts.wallAppeared(100));prompts.update(105,seated);assert.deepEqual(events,['classroom']);
  }
  for(const invalid of [NaN,Infinity,-1]){
    const events: string[]=[];
    const prompts=new SecondBoxPrompts({onSit:()=>events.push('sit'),onClassroom:()=>events.push('classroom')});
    prompts.requestSit(true);prompts.wallAppeared(1);prompts.update(invalid,seated);prompts.update(100,seated);
    assert.deepEqual(events,[]);
  }
  const events: string[]=[];
  const prompts=new SecondBoxPrompts({onSit:()=>events.push('sit'),onClassroom:()=>{}});
  prompts.requestSit(true);prompts.update(1,hidden);prompts.update(2,seated);assert.deepEqual(events,[]);
});

test('reentrant recovery during the sit callback cannot release a pending classroom cue', () => {
  const events: string[]=[];
  const prompts=new SecondBoxPrompts({onSit:()=>{events.push('sit');prompts.reset();},onClassroom:()=>events.push('classroom')});
  prompts.requestSit(true);prompts.wallAppeared(0);prompts.update(5,seated);prompts.update(20,seated);
  assert.deepEqual(events,['sit']);
});
