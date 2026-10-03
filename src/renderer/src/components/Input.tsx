import styled from 'styled-components'

type InputProps = React.ComponentPropsWithoutRef<'input'>

const Input = (props: InputProps): React.JSX.Element => <Wrapper {...props} />

const Wrapper = styled.input`
  height: 28px;
  padding: 0 10px;
  background: var(--board-bg-raised);
  color: var(--board-ink);
  border: 1px solid var(--board-control-line);
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  transition:
    border-color 0.12s,
    background-color 0.12s;

  &::placeholder {
    color: var(--board-ink-dim);
  }

  &:focus {
    outline: none;
    border-color: var(--board-ink);
  }
`

export default Input
