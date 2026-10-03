import tseslint from 'typescript-eslint';
export default tseslint.config({ignores:['**/.next/**','**/dist/**','**/next-env.d.ts','**/node_modules/**']},...tseslint.configs.recommended,{rules:{'@typescript-eslint/no-explicit-any':'error','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}],'@typescript-eslint/no-non-null-assertion':'off'}}); 
