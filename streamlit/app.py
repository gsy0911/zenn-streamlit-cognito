import streamlit as st
import plotly.express as px
import plotly.io as pio

# data
data = px.data.iris()

# side menu
st.sidebar.markdown(
    "sample"
)
template = st.sidebar.selectbox(
    "Template", list(pio.templates.keys())
)

# body
st.write(
    px.scatter(data, x="sepal_width", y="sepal_length", template=template)
)
