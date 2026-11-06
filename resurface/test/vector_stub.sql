-- Stand-in for pgvector so the SQL can be tested on a plain PostgreSQL. NOT for production (Supabase has the real extension).
create domain vector as real[];
create function stub_cosdist(a real[], b real[]) returns float8 language plpgsql immutable as $$
declare dot float8 := 0; na float8 := 0; nb float8 := 0; i int;
begin for i in 1..array_length(a,1) loop dot := dot + a[i]*b[i]; na := na + a[i]*a[i]; nb := nb + b[i]*b[i]; end loop;
  if na = 0 or nb = 0 then return 1; end if; return 1 - dot / (sqrt(na)*sqrt(nb)); end $$;
create operator <=> (leftarg = real[], rightarg = real[], function = stub_cosdist);
create function stub_acc(s float8[], v real[]) returns float8[] language plpgsql immutable as $$
declare i int; r float8[]; begin if s is null then s := array_fill(0::float8, array[array_length(v,1)+1]); end if; r := s;
  for i in 1..array_length(v,1) loop r[i] := r[i] + v[i]; end loop; r[array_length(v,1)+1] := r[array_length(v,1)+1] + 1; return r; end $$;
create function stub_fin(s float8[]) returns real[] language plpgsql immutable as $$
declare i int; n int; r real[]; begin if s is null then return null; end if; n := array_length(s,1)-1; r := array_fill(0::real, array[n]);
  for i in 1..n loop r[i] := s[i] / s[n+1]; end loop; return r; end $$;
create aggregate avg(real[]) (sfunc = stub_acc, stype = float8[], finalfunc = stub_fin);
